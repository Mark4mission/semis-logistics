#!/usr/bin/env node
/* 릴리스 버전 스탬프 — 사용: node tools/bump-version.cjs 1.0.1
   1) js/app.js 의 VERSION 갱신
   2) index.html · edu.html 의 로컬 css/js 참조에 ?v=<버전> 부여 (브라우저 캐시 무효화)
   ※ 캐시 스탬프가 없으면 배포 후에도 구버전 CSS/JS가 남아 화면이 갱신되지 않습니다. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ver = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(ver || "")) {
  console.error("사용법: node tools/bump-version.cjs <major.minor.patch>");
  process.exit(1);
}

const appPath = path.join(ROOT, "js/app.js");
let app = fs.readFileSync(appPath, "utf8");
if (!/const VERSION = "\d+\.\d+\.\d+";/.test(app)) {
  console.error("js/app.js 의 VERSION 선언을 찾지 못했습니다."); process.exit(1);
}
app = app.replace(/const VERSION = "\d+\.\d+\.\d+";/, `const VERSION = "${ver}";`); // 같은 버전 재실행도 허용(멱등)
fs.writeFileSync(appPath, app);

const htmlPath = path.join(ROOT, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
let n = 0;
html = html.replace(/(href|src)="((?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[\d.]+)?"/g, (m, attr, file) => {
  n++;
  return `${attr}="${file}?v=${ver}"`;
});
fs.writeFileSync(htmlPath, html);
/* 로그인 없는 공개 화면(edu.html 이수 등록 · learn.html 교육 이수)도 같은 스탬프 */
const stamped = [];
["edu.html", "learn.html"].forEach((name) => {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) return;
  let k = 0;
  const out = fs.readFileSync(p, "utf8").replace(/(href|src)="((?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[\d.]+)?"/g, (x, attr, file) => {
    k++;
    return `${attr}="${file}?v=${ver}"`;
  });
  fs.writeFileSync(p, out);
  stamped.push(name + " " + k + "건");
});
console.log(`v${ver} — app.js VERSION 갱신, index.html 캐시 스탬프 ${n}건 · ${stamped.join(" · ")} 적용`);
