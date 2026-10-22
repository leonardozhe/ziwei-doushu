#!/usr/bin/env bash
# 构建并重启生产服务
#
#   ./build-and-deploy.sh
#
# 流程：拉代码 → typecheck → 回归测试 → next build → 重启 systemd 服务
set -euo pipefail

APP_DIR="${ZIWEI_APP_DIR:-/home/ci/dev/ziwei-global/app}"
LOG_DIR="${ZIWEI_LOG_DIR:-/home/ci/dev/ziwei-global/logs}"

cd "$APP_DIR"
mkdir -p "$LOG_DIR"

echo "[$(date +%T)] 拉取代码"
git pull origin main

echo "[$(date +%T)] 类型检查"
npx tsc --noEmit

echo "[$(date +%T)] 回归测试"
npm test

echo "[$(date +%T)] 生产构建"
rm -rf .next
npx next build

if systemctl is-active --quiet ziwei; then
  echo "[$(date +%T)] 重启服务"
  sudo systemctl restart ziwei
  sleep 4
  systemctl --no-pager status ziwei | head -12
else
  echo "[$(date +%T)] ziwei 服务未安装，跳过重启（开发模式用 npx next dev -p 3020）"
fi

echo "[$(date +%T)] 完成"
curl -s -m 15 http://127.0.0.1:3020/api/health || true
echo
