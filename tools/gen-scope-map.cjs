/* js/scope.js 의 메뉴 범위 대응표 → tools/sql/semis-logi-scope.sql 의 <scope-map> 구간.
   사용: node tools/gen-scope-map.cjs          (출력만)
         node tools/gen-scope-map.cjs --write  (SQL 파일의 구간을 바꿔 씀) */
"use strict";
const fs = require("fs");
const path = require("path");
const S = require("../js/scope.js");
const out = S.sql();
if (process.argv.includes("--write")) {
  const f = path.join(__dirname, "sql", "semis-logi-scope.sql");
  const src = fs.readFileSync(f, "utf8");
  const re = /-- <scope-map>[\s\S]*?-- <\/scope-map>/;
  if (!re.test(src)) { console.error("구간 표지(-- <scope-map> … -- </scope-map>)가 없습니다: " + f); process.exit(1); }
  fs.writeFileSync(f, src.replace(re, out));
  console.log("갱신: " + f);
} else {
  console.log(out);
}
