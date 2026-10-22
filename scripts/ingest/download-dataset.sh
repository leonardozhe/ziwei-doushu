#!/usr/bin/env bash
# 下载解读数据集 v4.0 的压缩包（只下 161MB，不下 56.6GB 解压产物）
#
#   ./download-dataset.sh [目标目录]
#
# 强烈建议：在**有代理的本地机器**上跑这个脚本，然后把产物传到 199 服务器。
# 199 服务器直连 GitHub 只有 ~40KB/s，全量要 1 小时以上。
set -euo pipefail

DEST="${1:-./_data_cache}"
REPO="Renhuai123/ziwei-doushu"
TAG="v4.0-13d"

mkdir -p "$DEST"
cd "$DEST"

if ! command -v gh >/dev/null 2>&1; then
  echo "需要 GitHub CLI (gh): https://cli.github.com" >&2
  exit 1
fi

echo "[$(date +%T)] 下载 $TAG 的 77 个年份文件 + 校验文件"
gh release download "$TAG" --repo "$REPO" \
  -p "*.jsonl.zst" -p "MANIFEST.json" -p "SHA256SUMS.txt" -p "SHA256SUMS-all.txt"

echo "[$(date +%T)] 校验"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c SHA256SUMS.txt
else
  shasum -a 256 -c SHA256SUMS.txt
fi

echo "[$(date +%T)] 完成，共 $(ls *.jsonl.zst | wc -l) 个年份文件，$(du -sh . | cut -f1)"
echo
echo "下一步：把产物传到 199 服务器"
echo "  tar -cf - -C '$DEST' . | ssh ci199 'mkdir -p ~/dev/ziwei-global/data/raw && tar -xf - -C ~/dev/ziwei-global/data/raw'"
echo "然后在服务器上："
echo "  cd ~/dev/ziwei-global/app && bash scripts/ingest/load-all.sh"
