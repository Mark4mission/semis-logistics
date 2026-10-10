/* docs/ARGO-GUIDE.md → tools/edge/argo-guide.ts (Edge Function semis-logi-argo 에 함께 배포하는 안내 지식 사본).
   머리의 관리용 인용문(>)은 빼고 넣는다. 실행: npm run argo:guide  ·  테스트 AR 이 두 사본이 같은지 확인한다. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function guideText(md) {
  return String(md).split("\n").filter(l => !/^>/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
function tsOf(md) {
  return "/* 자동 생성 — docs/ARGO-GUIDE.md 를 고친 뒤 npm run argo:guide. 직접 고치지 말 것 */\n" +
    "export const GUIDE: string = `" + guideText(md).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`;\n";
}
module.exports = { guideText, tsOf };

if (require.main === module) {
  const md = fs.readFileSync(path.join(ROOT, "docs/ARGO-GUIDE.md"), "utf8");
  fs.writeFileSync(path.join(ROOT, "tools/edge/argo-guide.ts"), tsOf(md));
  console.log("tools/edge/argo-guide.ts — " + guideText(md).length + "자");
}
