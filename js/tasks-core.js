/* Task 관리 공통 로직(화면 없음) — 할 일(SeMIS.data.tasks) 칸 정리 · 빠른 입력 날짜 말 · 기한 묶음 · 분류 · 사용 조건.
   Task 관리 화면 · 일정관리 · 검색 · 홈 띠 · 아르고 · 접수 카운터가 window.SemisTasks 로 함께 쓴다. */
"use strict";

(() => {
  const KEY = "tasks";
  const PART = "안전보안파트";
  const KST = 9 * 3600e3;
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const p2 = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? y + "-" + p2(m) + "-" + p2(d) : "";
  };
  const isISO = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : ""); return !!m && ymd(+m[1], +m[2], +m[3]) === s; };
  const isHM = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const diffDays = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
  const dowOf = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
  const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
  let fixedToday = "";
  const today = () => fixedToday || new Date(Date.now() + KST).toISOString().slice(0, 10);
  /* 기한 묶음 · 요약 · 마친 일 묶음이 같은 주 · 같은 날을 보게 화면도 이 셋만 쓴다 */
  const weekStart = (td) => addDays(td, -((dowOf(td) + 6) % 7));   // 주 = 월~일
  const dayOf = (ts) => { const n = Date.parse(ts || ""); return isNaN(n) ? "" : new Date(n + KST).toISOString().slice(0, 10); };   // 저장된 ISO 시각 → 한국 날짜
  const dayLabel = (iso, td) => (iso.slice(0, 4) === td.slice(0, 4) ? iso.slice(5) : iso) + "(" + DOW[dowOf(iso)] + ")";

  const list = () => (SeMIS.data && Array.isArray(SeMIS.data[KEY]) ? SeMIS.data[KEY] : []);

  /* ── 분류 ── */
  const CATS = {
    equip: { label: "장비 · 시설", ico: "wrench", color: "teal" },
    check: { label: "점검 · 수검", ico: "clipboard", color: "red" },
    edu: { label: "교육", ico: "book", color: "green" },
    meet: { label: "회의", ico: "users", color: "blue" },
    doc: { label: "보고 · 제출", ico: "doc", color: "brown" },
    etc: { label: "기타", ico: "pin", color: "gray" }
  };
  /* 업무 분야(장비 · 점검 · 교육 · 회의)를 동작(보고 · 제출)보다 먼저 본다 — 이 파트 일은 대부분 제출 · 보고로 끝나서
     동작을 먼저 보면 거의 모두 '보고 · 제출'이 되어 색 구분이 사라진다 */
  const CAT_ORDER = ["equip", "check", "edu", "meet", "doc", "etc"];
  const CAT_WORDS = {
    equip: ["장비", "검색기", "엑스레이", "x-ray", "etd", "cctv", "수리", "고장", "교체", "설치", "시설"],
    check: ["점검", "수검", "심사", "감사", "평가", "순찰", "인증", "aeo", "tsa", "acc3"],
    edu: ["교육", "훈련", "이수", "강의", "연수", "전파", "세미나"],
    meet: ["회의", "미팅", "간담회", "협의", "면담", "보고회"],
    doc: ["보고", "제출", "회신", "공문", "작성", "서류", "결재", "기안", "계획서"]
  };
  function catOf(t) {
    t = t || {};
    if (has(CATS, t.cat)) return t.cat;
    let s = (String(t.t || "") + " " + String(t.memo || "")).toLowerCase();
    /* 담당자 이름 속 글자가 분류 말로 잡히지 않게 먼저 뺀다('가나이수' 의 '이수' → 교육) */
    (Array.isArray(t.who) ? t.who : []).map(w => String(w == null ? "" : w).trim().toLowerCase()).filter(Boolean)
      .sort((a, b) => b.length - a.length).forEach(w => { s = s.split(w).join(" "); });
    return CAT_ORDER.find(k => (CAT_WORDS[k] || []).some(w => s.indexOf(w) >= 0)) || "etc";
  }

  /* ── 칸 정리(멱등) ── */
  const SRC = ["", "desk", "argo"];
  const cut = (v, n) => (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, n).trim();
  const names = (a) => {
    const out = [];
    (Array.isArray(a) ? a : []).forEach(x => { const s = cut(x, 40); if (s && out.indexOf(s) < 0 && out.length < 8) out.push(s); });
    return out;
  };
  /* 화면은 내용을 2줄까지 그리므로 줄바꿈은 하나만 남긴다 */
  const lines2 = (v) => { let n = 0; return cut(v, 1e5).replace(/\r\n?|\n/g, () => (n++ ? " " : "\n")).slice(0, 300).trim(); };
  const KNOWN = ["id", "t", "memo", "due", "time", "place", "who", "teams", "cat", "star", "done", "doneAt", "doneBy", "at", "by", "upAt", "upBy", "src", "file"];
  function norm(t) {
    const o = t && typeof t === "object" ? t : {};
    const due = isISO(o.due) ? o.due : "";
    const done = o.done === true;
    const n = {
      id: o.id,
      t: lines2(o.t),
      memo: cut(o.memo, 2000),
      due,
      time: due && isHM(o.time) ? o.time : "",
      place: cut(o.place, 100),
      who: names(o.who),
      teams: names(o.teams),
      cat: has(CATS, o.cat) ? o.cat : "",
      star: o.star === true,
      done,
      doneAt: done ? cut(o.doneAt, 40) : "",
      doneBy: done ? cut(o.doneBy, 40) : "",
      at: cut(o.at, 40), by: cut(o.by, 40),
      upAt: cut(o.upAt, 40), upBy: cut(o.upBy, 40),
      src: SRC.indexOf(o.src) >= 0 ? o.src : ""
    };
    const f = o.file;
    if (f && typeof f === "object" && typeof f.url === "string") n.file = { name: typeof f.name === "string" ? f.name : "", url: f.url };
    /* 모르는 칸은 그대로 둔다(아는 칸 뒤, 원래 순서 — 멱등) — 다음 버전이 더한 칸을 옛 탭이 지워 서버에 되돌려 보내지 않게 */
    Object.keys(o).forEach(k => { if (KNOWN.indexOf(k) < 0) n[k] = o[k]; });
    return n;
  }
  const rid = () => { let s = ""; while (s.length < 10) s += Math.random().toString(36).slice(2); return s.slice(0, 10); };
  function make(fields, src) {
    const now = new Date().toISOString(), by = me();
    return norm(Object.assign({}, fields, { id: "tk_" + rid(), at: now, upAt: now, by, upBy: by, done: false, src }));
  }

  /* ── 빠른 입력 말 ──
     날만(20일 — 공문의 '20일 이내 회신' 같은 기간) · 월말(정기 '월말 보고'의 이름)은 알아듣지 않는다.
     정규식은 뒤돌아보기(?<…)를 쓰지 않는다 — 지원하지 않는 브라우저에서는 이 파일 전체가 읽히지 않는다 */
  const B = "(^|[^가-힣A-Za-z0-9])";
  const BN = "(^|[^가-힣A-Za-z0-9./:-])";   // 2026.11.20 의 11.20 · 10:30 의 30 같은 조각을 따로 잡지 않게
  /* 뒤 경계 — 기한 말에 흔히 붙는 토씨는 함께 뺀다. 날짜 뒤 '부터'는 시작 날이라 기한으로 잡지 않고,
     시각 뒤 '부터'는 그 일을 하는 시각이라 잡는다 */
  const end = (pp, num) => "(?:" + pp + ")?(?![가-힣A-Za-z0-9]" + (num ? "|[./:-]\\d" : "") + ")";
  const E = end("까지|에"), EN = end("까지|에", true);
  const ET = end("까지|부터|에"), ETN = end("까지|부터|에", true);
  /* 반복 일은 한 번의 기한이 아니므로 날짜 · 시각을 하나도 알아듣지 않는다 */
  const REPEAT = /(^|[^가-힣])(매주|매월|매일|격주|매년)(?![가-힣])/;
  /* 연도 없는 날짜는 올해 — 30일 넘게 지났으면 내년(12월에 적는 1월 일). M.D 꼴은 소수(평점 4.5)와 헷갈리므로 넘기지 않고 버린다 */
  const md = (mo, d, td, roll) => {
    const y = +td.slice(0, 4), iso = ymd(y, mo, d);
    if (!iso || diffDays(iso, td) <= 30) return iso;
    return roll ? ymd(y + 1, mo, d) : "";
  };
  const DATE_RX = [
    [BN + "(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})" + EN, (m) => ymd(+m[2], +m[3], +m[4])],
    [BN + "(\\d{1,2})월\\s*(\\d{1,2})일" + E, (m, td) => md(+m[2], +m[3], td, true)],
    [BN + "(\\d{1,2})/(\\d{1,2})" + EN, (m, td) => md(+m[2], +m[3], td, true)],
    [BN + "(\\d{1,2})\\.(\\d{1,2})" + EN, (m, td) => md(+m[2], +m[3], td, false)],
    [B + "(오늘|내일|모레|글피)" + E, (m, td) => addDays(td, ["오늘", "내일", "모레", "글피"].indexOf(m[2]))],
    /* 주 뒤에 홀로 쓴 '일'은 '일 정리' 같은 낱말이 많아 일요일로 보지 않는다('일요일'만) */
    [B + "(이번\\s?주|금주|다음\\s?주|차주)(?:\\s*(?:([월화수목금토])(?:요일)?|(일)요일))?" + E, (m, td) => {
      const mon = weekStart(td), next = !/^(이번|금주)/.test(m[2]), day = m[3] || m[4];
      if (!day) return next ? addDays(mon, 7) : "";
      return addDays(mon, (next ? 7 : 0) + (DOW.indexOf(day) + 6) % 7);
    }],
    [B + "([월화수목금토일])요일" + E, (m, td) => addDays(td, (DOW.indexOf(m[2]) - dowOf(td) + 7) % 7)]
  ];
  const hm = (ap, h, mi, guessPm) => {
    if (ap === "오후" && h < 12) h += 12;
    else if (ap === "오전" && h === 12) h = 0;
    else if (!ap && guessPm && h >= 1 && h <= 6) h += 12;   // 업무 시간 — '3시'는 오후 3시
    return h <= 23 && mi <= 59 ? p2(h) + ":" + p2(mi) : "";
  };
  const TIME_RX = [
    [BN + "(오전|오후)?\\s*(\\d{1,2}):(\\d{2})" + ETN, (m) => hm(m[2], +m[3], +m[4], false)],
    [BN + "(오전|오후)?\\s*(\\d{1,2})시(?!간)(?:\\s*(\\d{1,2})분|\\s*(반))?" + ET, (m) => hm(m[2], +m[3], m[5] ? 30 : +(m[4] || 0), true)]
  ];
  function find(src, rules, td, taken) {
    for (const [re, fn] of rules) {
      const rx = new RegExp(re, "g");
      let m;
      while ((m = rx.exec(src))) {
        const a = m.index + m[1].length, b = m.index + m[0].length;
        const v = taken && a < taken.b && taken.a < b ? "" : fn(m, td);
        if (v) return { v, a, b, raw: src.slice(a, b).trim() };
        rx.lastIndex = a + 1;
      }
    }
    return null;
  }
  /* 글에 그대로 있는 이름 — 더 긴 이름 속에만 있는 짧은 이름('가나다' 속 '가나')은 담지 않는다 */
  function namesIn(src, arr) {
    const list = [], hit = [];
    (Array.isArray(arr) ? arr : []).forEach(x => { const s = String(x == null ? "" : x).trim(); if (s && list.indexOf(s) < 0) list.push(s); });
    let rest = src;
    list.slice().sort((a, b) => b.length - a.length).forEach(s => { if (rest.indexOf(s) >= 0) { hit.push(s); rest = rest.split(s).join("\u0000"); } });
    return list.filter(s => hit.indexOf(s) >= 0);
  }
  function parse(text, opts) {
    opts = opts || {};
    const td = isISO(opts.today) ? opts.today : today();
    const src = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    const rep = REPEAT.test(src);
    const d = rep ? null : find(src, DATE_RX, td, null);
    const tm = rep ? null : find(src, TIME_RX, td, d);
    const hits = [d, tm].filter(Boolean);
    let rest = src;
    hits.slice().sort((x, y) => y.a - x.a).forEach(h => { rest = rest.slice(0, h.a) + " " + rest.slice(h.b); });
    rest = rest.replace(/\s+/g, " ").trim();
    /* 시각만 있으면 오늘 — 날짜 없는 시각은 저장 때 지워지므로(norm) */
    const due = d ? d.v : tm ? td : "";
    /* 남는 글이 없으면 원문 그대로 — 며칠 뒤 '내일'만 남은 줄이 무슨 일인지 헷갈리지 않게 */
    return { t: rest || src, due, time: tm ? tm.v : "", who: namesIn(src, opts.names), teams: namesIn(src, opts.teams), hits: hits.map(h => h.raw) };
  }

  /* ── 기한 묶음 ── */
  const BUCKETS = [["late", "지난 일"], ["today", "오늘"], ["tomorrow", "내일"], ["week", "이번 주"], ["later", "그 뒤"], ["none", "날짜 없음"]];
  function dueInfo(t, td) {
    td = isISO(td) ? td : today();
    const due = t && isISO(t.due) ? t.due : "";
    if (!due) return { b: "none", label: "", days: null };
    const days = diffDays(td, due), tm = isHM(t.time) ? " " + t.time : "";
    if (days < 0) return { b: "late", label: -days + "일 지남", days };
    if (days === 0) return { b: "today", label: "오늘" + tm, days };
    if (days === 1) return { b: "tomorrow", label: "내일" + tm, days };
    return { b: due <= addDays(weekStart(td), 6) ? "week" : "later", label: dayLabel(due, td) + tm, days };
  }

  /* ── 사람 · 권한 ── */
  /* 화면의 협력업체 등급은 편집 허용 업체면 3 이 되므로 등급만 보지 않는다(서버는 협력업체에 이 행을 주지 않음) */
  const canUse = () => { const u = SeMIS.user; return !!u && u.role !== "vendor" && u.role !== "signer" && SeMIS.roleRank() >= 3; };
  const me = () => { const u = SeMIS.user; return (u && u.name) || ""; };
  const partPeople = () => {
    const R = window.SemisRoster, out = [];
    if (!R) return out;
    R.active().forEach(p => { const n = String((p && p.name) || "").trim(); if (n && R.groupOf(p) === PART && out.indexOf(n) < 0) out.push(n); });
    return out;
  };
  /* 계정 이름이 명단의 파트 사람과 같을 때만 '나'를 쓴다 — 여럿이 한 계정을 쓰면 엉뚱한 이름이 담당으로 쌓인다 */
  const meInPart = () => { const n = me(); return !!n && partPeople().indexOf(n) >= 0; };
  const teamNames = () => (window.SemisRoster ? window.SemisRoster.groups().map(x => x.g) : []);
  /* 이름 해시만 쓰면 파트 사람끼리 같은 색이 되므로 명단의 파트 사람은 명단 순서대로 다른 색(6명까지 겹치지 않음),
     명단 밖 이름은 글자 해시(FNV-1a)라 명단 순서가 바뀌어도 같은 색 */
  const PCOL = ["blue", "green", "orange", "purple", "teal", "rose"];
  /* 칩마다 부르므로 파트 명단 차례를 한 번 그리는 동안만 기억한다 — 명단은 제자리에서 고쳐지기도 해서(인원 관리 저장)
     명단 · 사람 배열 · 사람 수가 같아도 다음 차례에는 다시 센다 */
  let pc = null;
  function partIndex() {
    const r = SeMIS.data && SeMIS.data.roster, ps = r && r.people, n = Array.isArray(ps) ? ps.length : -1;
    if (!pc || pc.r !== r || pc.ps !== ps || pc.n !== n) {
      pc = { r, ps, n, m: new Map(partPeople().map((x, i) => [x, i])) };
      setTimeout(() => { pc = null; }, 0);
    }
    return pc.m;
  }
  const personColor = (name) => {
    const s = String(name || ""), i = partIndex().get(s);
    if (i != null) return PCOL[i % PCOL.length];
    let h = 0x811c9dc5;
    for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193) >>> 0;
    return PCOL[h % PCOL.length];
  };
  /* 여러 이름 칸(담당 · 관련 팀 직접 적기 · 접수 카운터 줄)이 같은 구분 규칙을 쓰게 — 일정관리 담당 칸의 '、 ·' 도 받는다 */
  const splitNames = (s) => String(s == null ? "" : s).split(/\s*[,，、·]\s*/).map(x => x.trim()).filter(Boolean);

  window.SemisTasks = {
    KEY, CATS, CAT_ORDER, BUCKETS, list, catOf, norm, make, parse, dueInfo,
    canUse, me, meInPart, partPeople, teamNames, personColor, splitNames, today, weekStart, dayOf, dayLabel, addDays,
    setToday(iso) { fixedToday = isISO(iso) ? iso : ""; }
  };
})();
