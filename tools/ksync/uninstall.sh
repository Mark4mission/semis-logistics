#!/bin/bash
# H:drive K드라이브 동기화 에이전트 제거(Mac) — LaunchAgent · 설치한 에이전트 · 설정 · 키체인 키를 지운다(기록 파일은 남김).
# 서버 쪽 키는 대시보드(시스템 설정 › K드라이브 동기화 › 보안)에서 [폐기]한다. K드라이브 · H:drive 자료는 건드리지 않는다.
set -euo pipefail
APP="$HOME/Library/Application Support/hdrive-ksync"
PLIST="$HOME/Library/LaunchAgents/kr.hdrive.ksync.plist"
SECURITY="${KSYNC_SECURITY:-/usr/bin/security}"
LAUNCHCTL="${KSYNC_LAUNCHCTL:-/bin/launchctl}"

"$LAUNCHCTL" bootout "gui/$(id -u)/kr.hdrive.ksync" >/dev/null 2>&1 || true
rm -f "$PLIST"
read -r -p "설정 · 키체인 키도 지울까요? [y/N]: " ALL || true
if [[ "${ALL:-}" =~ ^[Yy]$ ]]; then
  "$SECURITY" delete-generic-password -s hdrive-ksync >/dev/null 2>&1 || true
  rm -rf "$APP"
  echo "에이전트 · 설정 · 키를 지웠습니다. 대시보드에서 서버 쪽 키를 [폐기]하세요."
else
  rm -rf "$APP/agent"
  echo "에이전트를 멈추고 지웠습니다(설정 · 키는 남김 — install.sh 로 다시 설치)."
fi
echo "기록: ~/Library/Logs/hdrive-ksync.log (필요 없으면 직접 지우세요)"
