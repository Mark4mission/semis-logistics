/* 인원 관리 — 임직원(인원 현황 엑셀) · 협력업체 통합 명단. 교육 전파 · 서명 등 다른 화면이 이 명단을 읽는다.
   SeMIS.data.roster = { team, people[{ id, name, org(에어제타 | 업체), part(에어제타만), emp, gender(M|F|), title, left, note }], orgs[](협력업체 소속 목록) }
   — 명단 · 사번은 공용 DB 에만(권한표 2/3 — manager 보기 · hq 고치기). 그룹 = 에어제타는 파트, 그 밖은 소속 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "roster", KEY = "roster", TITLE = "인원 관리";
  const SELF = "에어제타", TEAM = "인천화물팀";
  const D = () => SeMIS.data;
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const P = () => (isObj(D()[KEY]) ? D()[KEY] : (D()[KEY] = { team: TEAM, people: [], orgs: [] }));
  const people = () => (Array.isArray(P().people) ? P().people : (P().people = [])).filter(isObj);
  const active = () => people().filter(p => !p.left);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const p2 = (n) => String(n).padStart(2, "0");
  let fixedToday = "";
  const todayISO = () => fixedToday || (() => { const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); })();
  const dot = (s) => (isISO(s) ? s.replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const nkey = (s) => String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
  const empKey = (s) => String(s == null ? "" : s).replace(/[^0-9A-Za-z]/g, "").toLowerCase().replace(/^kj(?=\d)/, "");
  const uid = (p) => (p || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const arrOf = (v) => (Array.isArray(v) ? v : []);
  const canW = () => SeMIS.canEdit();
  const groupOf = (p) => (p && p.org === SELF && norm(p.part) ? norm(p.part) : norm((p && p.org) || "") || "기타");
  const orgLabel = (p) => [p.org, p.org === SELF ? p.part : ""].filter(Boolean).join(" · ");
  function groups() {
    const m = new Map();
    active().forEach(p => { const g = groupOf(p); if (!m.has(g)) m.set(g, { g, self: p.org === SELF, n: 0 }); m.get(g).n++; });
    arrOf(P().orgs).forEach(o => { o = norm(o); if (o && !m.has(o)) m.set(o, { g: o, self: false, n: 0 }); });
    return Array.from(m.values()).sort((a, b) => (b.self - a.self) || a.g.localeCompare(b.g, "ko"));
  }
  let rq = "", rgrp = "", rnog = false;

  const GENDER = { M: "남", F: "여" };
  function rosterRows() {
    const qq = nkey(rq);
    return people().filter(p => (!rgrp || groupOf(p) === rgrp) && (!rnog || (!p.gender && !p.left)) && (!qq || [p.name, p.org, p.part, p.emp, p.title].map(nkey).join(" ").indexOf(qq) >= 0))
      .sort((a, b) => (!!a.left - !!b.left) || ((b.org === SELF) - (a.org === SELF)) || groupOf(a).localeCompare(groupOf(b), "ko") || String(a.name).localeCompare(String(b.name), "ko"));
  }
  function rosterBody() {
    const rs = rosterRows(), w = canW();
    if (!rs.length) return ui.empty(people().length ? "조건에 맞는 사람이 없습니다." : "명단이 비어 있습니다. 인원 현황 엑셀을 반영하세요.");
    let last = "";
    return `<div class="table-wrap"><table class="tbl ln-ros tbl-keep"><thead><tr><th>이름</th><th>파트 · 소속</th><th>사번</th><th>직급</th><th>성별</th><th>비고</th></tr></thead><tbody>
      ${rs.map(p => { const g = p.left ? "퇴직 · 전출" : groupOf(p), head = g !== last ? `<tr class="ln-gh"><th colspan="6">${esc(g)}</th></tr>` : ""; last = g;
        return head + `<tr${w ? ` class="is-click" data-lp="${esc(p.id)}"` : ""}><td data-role="title"><b>${esc(p.name)}</b></td><td>${esc(orgLabel(p))}</td><td class="mono">${esc(p.emp || "-")}</td><td>${esc(p.title || "")}</td>
          <td>${w && !p.left ? `<select class="ln-gsel" data-gp="${esc(p.id)}" aria-label="${esc(p.name)} 성별"><option value=""${p.gender ? "" : " selected"}>-</option><option value="M"${p.gender === "M" ? " selected" : ""}>남</option><option value="F"${p.gender === "F" ? " selected" : ""}>여</option></select>` : esc(GENDER[p.gender] || "-")}</td>
          <td class="ln-dim">${esc(p.left ? dot(p.left) + " " : "")}${esc(p.note || "")}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  }
  function rosterView(root) {
    const ps = active(), self = ps.filter(p => p.org === SELF).length, nog = ps.filter(p => !p.gender).length, gs = groups();
    const rare = (id, ic, lb) => `<button type="button" class="btn btn-ghost ph-rare" data-lr="${id}">${icon(ic, 16)}<span>${lb}</span></button>`;
    root.innerHTML = ui.head({ title: TITLE, meta: (P().team || TEAM) + " · 협력업체",
      actions: (canW() ? `<button type="button" class="btn btn-primary" data-lr="xls">${icon("down", 17)}<span>인원 현황 엑셀 반영</span></button>` + rare("add", "plus", "사람 추가") + rare("partners", "users", "협력사 · 보안요원 명단 가져오기") + rare("orgs", "building", "협력업체 소속 목록") : "") })
      + ui.stats([{ label: "전체", value: ps.length + "명" }, { label: SELF, value: self + "명" }, { label: "협력업체", value: ps.length - self + "명" },
        { label: "성별 미입력", value: nog, tone: nog ? "warn" : "ok" }])
      + `<section class="card"><div class="toolbar">${ui.search("ln-rq", "이름 · 사번 검색", rq)}
          <label class="ck-f"><span class="m-hide">파트</span><select id="ln-rgrp" aria-label="파트 · 소속"><option value="">전체</option>${gs.map(x => `<option ${x.g === rgrp ? "selected" : ""}>${esc(x.g)}</option>`).join("")}</select></label>
          <button type="button" class="seg-btn ln-chipbtn" id="ln-rnog" aria-pressed="${rnog}">성별 미입력만</button></div>
        <div id="ln-ros-b">${rosterBody()}</div></section>`;
    const qi = $("#ln-rq", root);
    const repaint = () => { $("#ln-ros-b", root).innerHTML = rosterBody(); wireRoster(root); };
    qi.oninput = () => { const v = ui.searchValue(qi.value); if (v === rq) return; rq = v; repaint(); };
    $("#ln-rgrp", root).onchange = (ev) => { rgrp = ev.target.value; repaint(); };
    $("#ln-rnog", root).onclick = (ev) => { rnog = !rnog; ev.currentTarget.setAttribute("aria-pressed", String(rnog)); repaint(); };
    $$("[data-lr]", root).forEach(b => b.onclick = () => {
      const k = b.dataset.lr;
      if (k === "xls") return importRoster();
      if (k === "add") return personForm("");
      if (k === "partners") return importPartners();
      if (k === "orgs") return orgsForm();
    });
    wireRoster(root);
  }
  function wireRoster(root) {
    $$("[data-lp]", root).forEach(tr => tr.onclick = (ev) => { if (ev.target.closest("select")) return; personForm(tr.dataset.lp); });
    $$("[data-gp]", root).forEach(s => { s.onclick = (ev) => ev.stopPropagation(); s.onchange = () => {
      const p = people().find(x => x.id === s.dataset.gp);
      if (!p || !canW()) return;
      p.gender = s.value === "M" || s.value === "F" ? s.value : "";
      SeMIS.save();
    }; });
  }
  function personForm(id) {
    if (!canW()) return;
    const p = id ? people().find(x => x.id === id) : null;
    const x = p || { name: "", org: SELF, part: "", emp: "", gender: "", title: "", left: "", note: "" };
    const orgs = Array.from(new Set([SELF].concat(groups().filter(g => !g.self).map(g => g.g))));
    const parts = groups().filter(g => g.self).map(g => g.g);
    openModal(`<h3>${p ? "명단 고치기" : "사람 추가"}</h3>
      <div class="ln-grid">
        <div class="form-row"><label for="lp-name">이름</label><input id="lp-name" maxlength="20" value="${esc(x.name)}"></div>
        <div class="form-row"><label for="lp-org">소속</label><input id="lp-org" maxlength="30" list="lp-orgs" value="${esc(x.org)}"><datalist id="lp-orgs">${orgs.map(o => `<option value="${esc(o)}">`).join("")}</datalist></div>
        <div class="form-row"><label for="lp-part">파트 ${ui.tip ? ui.tip("에어제타 직원만 — 기록부는 파트별로 나뉩니다.") : ""}</label><input id="lp-part" maxlength="30" list="lp-parts" value="${esc(x.part)}"><datalist id="lp-parts">${parts.map(o => `<option value="${esc(o)}">`).join("")}</datalist></div>
        <div class="form-row"><label for="lp-emp">사번</label><input id="lp-emp" maxlength="12" value="${esc(x.emp)}"></div>
        <div class="form-row"><label for="lp-title">직급</label><input id="lp-title" maxlength="20" value="${esc(x.title)}"></div>
        <div class="form-row"><label for="lp-g">성별</label><select id="lp-g"><option value="">-</option><option value="M"${x.gender === "M" ? " selected" : ""}>남</option><option value="F"${x.gender === "F" ? " selected" : ""}>여</option></select></div>
        <div class="form-row"><label for="lp-left">퇴직 · 전출일</label><input type="date" id="lp-left" value="${esc(x.left)}"></div>
        <div class="form-row"><label for="lp-note">비고</label><input id="lp-note" maxlength="40" value="${esc(x.note)}"></div>
      </div>
      <div class="modal-actions">${p ? `<button type="button" class="btn btn-danger" id="lp-del" style="margin-right:auto">지우기</button>` : ""}<button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const dl = $("#lp-del");
    if (dl) dl.onclick = () => confirmModal(p.name + " — 명단에서 지울까요? 퇴직 · 전출이면 지우지 말고 퇴직 · 전출일을 넣으세요.", () => {
      P().people = people().filter(y => y !== p); SeMIS.save(); SeMIS.renderView();
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const v = (k) => norm($("#" + k).value);
      const rec = { name: v("lp-name").slice(0, 20), org: v("lp-org").slice(0, 30) || SELF, part: v("lp-part").slice(0, 30), emp: v("lp-emp").replace(/\s+/g, "").slice(0, 12),
        gender: $("#lp-g").value, title: v("lp-title").slice(0, 20), left: isISO($("#lp-left").value) ? $("#lp-left").value : "", note: v("lp-note").slice(0, 40) };
      if (nkey(rec.name).length < 2) { toast("이름을 적으세요.", true); return; }
      if (rec.org !== SELF) rec.part = "";
      if (rec.emp && people().some(y => y !== p && y.org === SELF && rec.org === SELF && empKey(y.emp) === empKey(rec.emp))) { toast("같은 사번이 이미 있습니다.", true); return; }
      if (p) Object.assign(p, rec); else P().people.push(Object.assign({ id: uid("lp") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView();
    };
  }
  function orgsForm() {
    const cur0 = arrOf(P().orgs).join("\n");
    openModal(`<h3>협력업체 소속 목록</h3>
      <div class="form-row"><label for="lo-orgs">한 줄에 하나 ${ui.tip ? ui.tip("명단에 사람이 없어도 학습 화면 '직접 입력'의 소속 목록에 나옵니다.") : ""}</label><textarea id="lo-orgs" rows="8">${esc(cur0)}</textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      P().orgs = Array.from(new Set($("#lo-orgs").value.split("\n").map(norm).filter(o => o && o !== SELF && o.length <= 30))).slice(0, 40);
      SeMIS.save(); closeModal(); SeMIS.renderView();
    };
  }
  function importPartners() {
    const pv = isObj(D().partners) ? D().partners : {};
    const vn = {}; arrOf(pv.vendors).forEach(v => { if (v && v.id) vn[v.id] = norm(v.name); });
    const add = [];
    arrOf(pv.staff).filter(s => s && !s.left && norm(s.name) && vn[s.vid]).forEach(s => {
      const org = vn[s.vid];
      if (people().some(p => p.org === org && nkey(p.name) === nkey(s.name)) || add.some(p => p.org === org && nkey(p.name) === nkey(s.name))) return;
      add.push({ id: uid("lp"), name: norm(s.name).slice(0, 20), org: org.slice(0, 30), part: "", emp: "", gender: "", title: norm(s.pos || "").slice(0, 20), left: "", note: "" });
    });
    if (!add.length) { toast("새로 가져올 사람이 없습니다."); return; }
    const byOrg = {}; add.forEach(p => { byOrg[p.org] = (byOrg[p.org] || 0) + 1; });
    confirmModal("협력사 · 보안요원 명단에서 " + add.length + "명을 가져올까요? (" + Object.keys(byOrg).map(o => o + " " + byOrg[o]).join(", ") + ")", () => {
      P().people = people().concat(add); SeMIS.save(); toast(add.length + "명을 넣었습니다."); SeMIS.renderView();
    });
  }

  /* 인원 현황 엑셀 — 표(성명 · 사번 · 직급 · 성별 …) 또는 파트 묶음 표(부서 | 파트 | 사번 | 성명 | 사번 | 성명 …) */
  function gridOf(table) {
    const grid = [], spans = [];
    Array.from(table.querySelectorAll("tr")).filter(tr => tr.closest("table") === table).forEach((tr, ri) => {
      const row = grid[ri] || (grid[ri] = []);
      let ci = 0;
      Array.from(tr.children).filter(c => c.tagName === "TD" || c.tagName === "TH").forEach(cell => {
        if (cell.tagName === "TH" && /^(\d+|[A-Z]{1,3})?$/.test(norm(cell.textContent))) return;
        while (row[ci] !== undefined) ci++;
        const rs = Math.max(1, Number(cell.getAttribute("rowspan")) || 1), cs = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
        const v = norm(cell.textContent);
        for (let r = 0; r < rs; r++) for (let c = 0; c < cs; c++) {
          const rr = grid[ri + r] || (grid[ri + r] = []);
          rr[ci + c] = r === 0 && c === 0 ? v : (r > 0 && c === 0 ? v : "");
        }
        ci += cs;
      });
      spans.push(0);
    });
    return grid.map(r => Array.from(r, v => v == null ? "" : v));
  }
  const isEmp = (v) => /^(kj)?\d{4,10}$/i.test(String(v || "").replace(/\.0$/, "").replace(/\s+/g, ""));
  const cleanEmp = (v) => String(v || "").replace(/\.0$/, "").replace(/\s+/g, "");
  const isName = (v) => /^[가-힣]{2,5}$/.test(String(v || "").replace(/\s+/g, "")) || /^[A-Za-z][A-Za-z .'-]{1,30}$/.test(String(v || ""));
  /* 파트 이름(Mark 11-12) — 'OO파트(수입)' · 'OO파트(통과)' 같은 담당 구분은 한 파트로(수입통과파트는 하나),
     지원담당 · 지원파트(인원 현황 엑셀은 '인천화물팀(지원담당)')는 부르는 이름 UCC 로 */
  const UCC = "UCC";
  const partName = (v) => {
    const s = norm(v);
    if (/^(.*\()?지원(담당|파트)\)?$/.test(s) || /^ucc$/i.test(s)) return UCC;
    const m = /^(.+파트)\s*\(.*\)$/.exec(s);
    return m ? m[1] : s;
  };
  const genderOf = (v) => { const s = norm(v).toLowerCase(); return /^(남|남자|m|male)$/.test(s) ? "M" : /^(여|여자|f|female)$/.test(s) ? "F" : ""; };
  function parseRoster(grids) {
    const list = [], info = {};
    let grid = false;
    grids.forEach(g => {
      let h = -1;
      for (let i = 0; i < Math.min(g.length, 15); i++) { const r = g[i]; if (r.some(v => /^(성명|이름)$/.test(v)) && r.some(v => /사번/.test(v))) { h = i; break; } }
      if (h < 0) return;
      const hd = g[h];
      const nameCols = hd.map((v, i) => (/^(성명|이름)$/.test(v) ? i : -1)).filter(i => i >= 0);
      if (nameCols.length >= 2) {
        grid = true;
        const empCols = nameCols.map(i => (/사번/.test(hd[i - 1] || "") ? i - 1 : hd.findIndex(v => /사번/.test(v))));
        const partCol = Math.max(0, Math.min.apply(null, empCols) - 1);
        let part = "";
        for (let r = h + 1; r < g.length; r++) {
          const row = g[r];
          if (row.some(v => /^※/.test(v))) break;
          if (norm(row[partCol]) && !isEmp(row[partCol])) part = partName(row[partCol]);
          nameCols.forEach((nc, k) => {
            const nm = norm(row[nc]), em = cleanEmp(row[empCols[k]]);
            if (isName(nm) && isEmp(em)) list.push({ name: nm, emp: em, part });
          });
        }
        return;
      }
      const col = (re) => hd.findIndex(v => re.test(v));
      const cN = col(/^(성명|이름)$/), cE = col(/사번/), cT = col(/^직급$/), cP = col(/^(파트|소속|부서)$/), cG = col(/^성별$/), cR = col(/^(비고|특이사항)$/);
      for (let r = h + 1; r < g.length; r++) {
        const row = g[r], nm = norm(row[cN]), em = cleanEmp(row[cE]);
        if (!isName(nm) || !isEmp(em)) continue;
        const nx = { name: nm, emp: em, title: cT >= 0 ? norm(row[cT]) : "", part: cP >= 0 ? partName(row[cP]) : "", gender: cG >= 0 ? genderOf(row[cG]) : "", note: cR >= 0 ? norm(row[cR]) : "" };
        const old = info[empKey(em)];   // 같은 사번이 여러 줄이면 빈 칸이 앞 줄 값을 지우지 않게
        info[empKey(em)] = old ? Object.keys(nx).reduce((o, k) => { o[k] = nx[k] || old[k]; return o; }, {}) : nx;
      }
    });
    if (grid) {
      list.forEach(p => { const x = info[empKey(p.emp)]; if (x) { p.title = x.title; p.gender = x.gender; } });
      return { grid: true, people: list };
    }
    return { grid: false, people: Object.keys(info).map(k => info[k]).filter(p => !/전출|퇴직|퇴사/.test(p.note)) };
  }
  function rosterDiff(parsed) {
    const cur0 = people().filter(p => p.org === SELF);
    const byEmp = {}; cur0.forEach(p => { if (p.emp) byEmp[empKey(p.emp)] = p; });
    const seen = new Set(), add = [], chg = [];
    parsed.people.forEach(n => {
      const k = empKey(n.emp);
      if (seen.has(k)) return;
      seen.add(k);
      const p = byEmp[k] || cur0.find(x => !x.emp && nkey(x.name) === nkey(n.name));
      if (!p) { add.push(n); return; }
      const d = {};
      if (n.name && n.name !== p.name) d.name = n.name;
      if (n.part && n.part !== p.part) d.part = n.part;
      if (n.title && n.title !== p.title) d.title = n.title;
      if (n.gender && n.gender !== p.gender) d.gender = n.gender;
      if (p.left) d.left = "";
      if (!p.emp) d.emp = n.emp;
      if (Object.keys(d).length) chg.push({ p, d });
    });
    const gone = parsed.grid ? cur0.filter(p => !p.left && !(p.emp && seen.has(empKey(p.emp))) && !parsed.people.some(n => nkey(n.name) === nkey(p.name) && !p.emp)) : [];
    return { add, chg, gone };
  }
  function importRoster() {
    if (!canW()) return;
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".xls,.xlsx,.xlsm";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        toast("엑셀을 읽는 중…");
        const r = await readRosterFile(f);
        rosterPreview(r);
      } catch (e) { toast(String(e.message) === "none" ? "성명 · 사번 열을 찾지 못했습니다." : "엑셀을 읽지 못했습니다.", true); }
    };
    inp.click();
  }
  async function readRosterFile(f) {
    const PV = window.SemisPreview;
    if (!PV || !PV.build) throw new Error("preview");
    const u8 = new Uint8Array(await f.arrayBuffer());
    const out = await PV.build(f.name, u8);
    const grids = [];
    ((out && out.parts) || []).forEach(pt => {
      const d = new DOMParser().parseFromString(String(pt.doc || ""), "text/html");
      Array.from(d.querySelectorAll("table")).forEach(t => { if (!t.parentElement || !t.parentElement.closest("table")) grids.push(gridOf(t)); });
    });
    const parsed = parseRoster(grids);
    if (!parsed.people.length) throw new Error("none");
    return parsed;
  }
  function rosterPreview(parsed) {
    const df = rosterDiff(parsed);
    const li = (xs, f) => xs.length ? `<ul class="ln-dif">${xs.slice(0, 40).map(f).join("")}${xs.length > 40 ? `<li class="ln-dim">외 ${xs.length - 40}명</li>` : ""}</ul>` : `<p class="ln-dim">없음</p>`;
    const LB = { name: "이름", part: "파트", title: "직급", gender: "성별", left: "재직", emp: "사번" };
    openModal(`<h3>인원 현황 엑셀 반영 <small class="ln-dim">${parsed.people.length}명 읽음</small></h3>
      <h4 class="ln-h4">새로 넣기 <b class="mono">${df.add.length}</b></h4>${li(df.add, n => `<li>${esc(n.name)} <span class="ln-dim">${esc([n.part, n.emp, n.title].filter(Boolean).join(" · "))}</span></li>`)}
      <h4 class="ln-h4">바뀜 <b class="mono">${df.chg.length}</b></h4>${li(df.chg, x => `<li>${esc(x.p.name)} <span class="ln-dim">${esc(Object.keys(x.d).map(k => LB[k] + " " + (k === "left" ? "복귀" : k === "gender" ? GENDER[x.d[k]] || "-" : x.d[k])).join(" · "))}</span></li>`)}
      ${parsed.grid ? `<h4 class="ln-h4">엑셀에 없음 → 퇴직 · 전출 처리 <b class="mono">${df.gone.length}</b></h4>${li(df.gone, p => `<li><label><input type="checkbox" data-gone="${esc(p.id)}" checked> ${esc(p.name)} <span class="ln-dim">${esc([p.part, p.emp].filter(Boolean).join(" · "))}</span></label></li>`)}` : ""}
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok" ${df.add.length + df.chg.length + df.gone.length ? "" : "disabled"}>반영</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const t = todayISO();
      df.add.forEach(n => P().people.push({ id: uid("lp"), name: n.name, org: SELF, part: n.part || "", emp: n.emp, gender: n.gender || "", title: n.title || "", left: "", note: "" }));
      df.chg.forEach(x => Object.assign(x.p, x.d));
      $$("#modal-box [data-gone]").forEach(cb => { if (!cb.checked) return; const p = people().find(y => y.id === cb.dataset.gone); if (p) p.left = t; });
      if (!P().team) P().team = TEAM;
      SeMIS.save(); closeModal(); toast("명단에 반영했습니다."); SeMIS.renderView();
    };
  }


  SeMIS.registerModule(MOD, { title: TITLE, render: rosterView });
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "users", module: MOD,
    items: () => active().map(p => ({ title: p.name, sub: [groupOf(p), p.emp, p.title].filter(Boolean).join(" · "), text: [p.name, p.emp, groupOf(p)], route: MOD, pick: () => { rq = p.name; rgrp = ""; rnog = false; } }))
  });
  window.SemisRoster = {
    SELF, TEAM, TITLE, data: P, people, active, groupOf, orgLabel, groups,
    parseRoster, rosterDiff, gridOf, readRosterFile, personForm,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    setState(o) { o = o || {}; if (o.q !== undefined) rq = o.q; if (o.grp !== undefined) rgrp = o.grp; if (o.nog !== undefined) rnog = !!o.nog; if (o.reset) { rq = ""; rgrp = ""; rnog = false; } }
  };
})();
