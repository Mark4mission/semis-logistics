#!/bin/bash
# H:drive K드라이브 동기화 에이전트 설치(Mac) — 에이전트를 ~/Library/Application Support/hdrive-ksync/agent 로 복사하고
# 설정(600) · 키(키체인 hdrive-ksync) · LaunchAgent(kr.hdrive.ksync: 로그인 때 · 30분마다 · 매일 실행 시작 시각 · 네트워크가 바뀔 때)를 만든다.
# 실제 주소 · 키는 이 Mac 에만 둔다(저장소에 넣지 않음). 다시 실행하면 갱신(키는 바꿀 때만 다시 입력).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/hdrive-ksync"
PLIST="$HOME/Library/LaunchAgents/kr.hdrive.ksync.plist"
LABEL="kr.hdrive.ksync"
SECURITY="${KSYNC_SECURITY:-/usr/bin/security}"
LAUNCHCTL="${KSYNC_LAUNCHCTL:-/bin/launchctl}"

say() { printf '%s\n' "$*"; }
die() { printf '설치 중단: %s\n' "$*" >&2; exit 1; }

# 1. Node ≥ 20 — 절대 경로(launchd 는 PATH 를 모른다)
NODE="${KSYNC_NODE:-}"
if [ -z "$NODE" ]; then
  for n in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$n" ] && [ "$("$n" -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then NODE="$n"; break; fi
  done
fi
[ -n "$NODE" ] && [ -x "$NODE" ] || die "Node 20 이상을 찾지 못했습니다(/opt/homebrew/bin/node · /usr/local/bin/node)"
say "Node: $NODE ($("$NODE" -v))"

# 2. 설정 — 서버 주소 · K드라이브 주소(이미 있으면 Enter 로 그대로)
mkdir -p "$APP"; chmod 700 "$APP"
OLD_SERVER=""; OLD_SMB=""
if [ -f "$APP/config.json" ]; then
  OLD_SERVER="$("$NODE" -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).server||""))}catch(e){}' "$APP/config.json")"
  OLD_SMB="$("$NODE" -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).smbUrl||""))}catch(e){}' "$APP/config.json")"
fi
read -r -p "동기화 서버 주소 [${OLD_SERVER:-https://<프로젝트>.supabase.co/functions/v1/semis-logi-ksync}]: " SERVER || true
SERVER="${SERVER:-$OLD_SERVER}"
[[ "$SERVER" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9./_-]*$ ]] || die "서버 주소 형식(https://…)"
read -r -p "K드라이브 주소 [${OLD_SMB:-smb://<서버>/<공유>}]: " SMB || true
SMB="${SMB:-$OLD_SMB}"
[[ "$SMB" =~ ^smb://[^\"\\]+/[^\"\\]+$ ]] || die "K드라이브 주소 형식(smb://<서버>/<공유>)"
( umask 077; "$NODE" -e 'const fs=require("fs");const p=process.argv[1];let o={};try{o=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){}
o.server=process.argv[2];o.smbUrl=process.argv[3];fs.writeFileSync(p,JSON.stringify(o,null,2)+"\n",{mode:0o600})' "$APP/config.json" "$SERVER" "$SMB" )
chmod 600 "$APP/config.json"
# 매일 실행 시작 시각(설정 dailyAt, 없으면 08:30) — 30분 간격 깨우기가 30분 창 바로 밖에 걸려도 창이 시작할 때 한 번 깨운다.
# 있는데 형식이 틀리면 멈춘다 — 에이전트도 그 설정으로는 돌지 않는다(checkConfig). '=' 는 값이 있다는 표시(빈 값도 틀린 형식)
DAILY="$("$NODE" -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).dailyAt;process.stdout.write(v==null?"":"="+String(v))}catch(e){}' "$APP/config.json")"
if [ -z "$DAILY" ]; then DAILY="08:30"; else DAILY="${DAILY#=}"; fi
[[ "$DAILY" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "설정 dailyAt 형식(HH:MM)이 맞지 않습니다 — $APP/config.json 을 고친 뒤 다시 실행하세요"
HOUR=$((10#${DAILY%%:*})); MINUTE=$((10#${DAILY##*:}))

# 3. 키 — 키체인에만. security 가 직접 묻는다(명령줄 · 기록에 남지 않게)
if "$SECURITY" find-generic-password -s hdrive-ksync -w >/dev/null 2>&1; then
  read -r -p "키체인에 키가 있습니다. 새 키로 바꿀까요? [y/N]: " RE || true
else RE="y"; fi
if [[ "${RE:-}" =~ ^[Yy]$ ]]; then
  say "대시보드(시스템 설정 › K드라이브 동기화 › ⋯ › 에이전트 키 발급)에서 받은 키를 붙여 넣으세요(두 번, 화면에 보이지 않음)."
  "$SECURITY" add-generic-password -U -s hdrive-ksync -a "${USER:-$(id -un)}" -l "H:drive K드라이브 동기화" -T /usr/bin/security -w
fi
KEYCHK="$("$SECURITY" find-generic-password -s hdrive-ksync -w 2>/dev/null || true)"
[[ "$KEYCHK" =~ ^[0-9a-f]{64}$ ]] || die "키 형식이 맞지 않습니다(64자리 영문 숫자) — 다시 실행해 키를 넣으세요"
unset KEYCHK

# 4. 에이전트 복사(저장소를 고쳐도 설치한 것만 돈다)
mkdir -p "$APP/agent"
cp "$SRC/ksync.mjs" "$SRC/plan.mjs" "$SRC/lib.mjs" "$APP/agent/"
printf '{ "type": "module" }\n' > "$APP/agent/package.json"
chmod 700 "$APP/agent"; chmod 600 "$APP/agent/"*

# 5. LaunchAgent — 로그인 때 · 30분마다(지금 동기화 요청 확인) · 매일 실행 시작 시각 · 네트워크 설정이 바뀔 때(사내망 · VPN 연결 감지)
x() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(x "$NODE")</string>
    <string>$(x "$APP/agent/ksync.mjs")</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>
  <key>WatchPaths</key>
  <array><string>/Library/Preferences/SystemConfiguration</string></array>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$(x "$APP/launchd.log")</string>
  <key>StandardErrorPath</key><string>$(x "$APP/launchd.log")</string>
</dict>
</plist>
EOF
chmod 644 "$PLIST"
"$LAUNCHCTL" bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
"$LAUNCHCTL" bootstrap "gui/$(id -u)" "$PLIST"

say "설치했습니다."
say "  지금 한 번: \"$NODE\" \"$APP/agent/ksync.mjs\" --once"
say "  계획만 보기: … --dry-run   상태: … --status   기록: ~/Library/Logs/hdrive-ksync.log"
say "  첫 실행 뒤 대시보드 '보안'의 후보 IP 가 회사 출구 IP 인지 확인하고 [허용]하세요."
