#!/usr/bin/env bash
# 备份解读数据库
#
#   ./backup-db.sh [目标目录]
#
# 用 pg_dump 的自定义格式（可 pg_restore 恢复），压缩后存到目标目录。
set -euo pipefail

CONN="${ZIWEI_DATABASE_URL:-postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei}"
DEST="${1:-/home/ci/dev/ziwei-global/backups}"
KEEP_DAYS="${ZIWEI_BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/ziwei-$STAMP.dump"

echo "[$(date +%T)] 备份到 $OUT"
pg_dump "$CONN" --format=custom --compress=6 --no-owner --file="$OUT"
echo "[$(date +%T)] 大小: $(du -h "$OUT" | cut -f1)"

# 清理过期备份
find "$DEST" -name 'ziwei-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete

echo "[$(date +%T)] 完成"
