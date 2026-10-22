# 开发环境：199 服务器

本项目的全部开发、数据与部署都在 **199 服务器（192.168.1.199）** 上进行，
代码通过 GitHub 仓库 `leonardozhe/ziwei-doushu` 同步，服务器是唯一的开发工作区。

---

## 1. 目录布局

```
/home/ci/dev/ziwei-global/
├── app/                     # 应用代码（git clone 自 GitHub）
├── data/
│   ├── raw/                 # 数据集压缩包（77 个 year-*.jsonl.zst，共 155MB）
│   └── work/                # 装载中间产物（用完即删）
├── db/                      # 数据库相关
├── logs/                    # 装载日志 / 开发服务器日志
└── backups/                 # 备份
```

`data/` 已在 `.gitignore` 中，数据集不入 Git。

---

## 2. 数据库

独立容器 `ziwei-postgres`（Postgres 16），不与机器上其他项目共用。

| 项 | 值 |
|---|---|
| 容器 | `ziwei-postgres` |
| 端口 | `127.0.0.1:5435`（只绑本机，不对外） |
| 库 / 用户 / 密码 | `ziwei` / `ziwei` / `ziwei_dev_pwd` |
| 数据卷 | `ziwei-global_ziwei-pgdata` |
| 启动 | `docker compose -f docker-compose.db.yml up -d` |

连接串（写进 `app/.env.local`）：

```
DATABASE_URL=postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei
```

---

## 3. 解读数据集 v4.0

来源：<https://github.com/Renhuai123/ziwei-doushu> Release `v4.0-13d`
许可：CC BY 4.0（商用需保留来源标注）

| 项 | 值 |
|---|---|
| 命盘数 | 674,976（1950–2026 真实日期 × 12 时辰 × 男女） |
| 解读段数 | 8,774,688（每盘 13 维） |
| 压缩后 | 161 MB（77 个年份文件） |
| 解压后 | 56.6 GB |
| 内容版本 | `ca268829f7a9` |

### 3.1 下载

**不要下载 56.6 GB 的解压产物** —— 只下 161 MB 的压缩包，
解压与入库都在服务器本地完成，避免走代理流量。

```bash
# 在本地机器（有代理）下载
gh release download v4.0-13d --repo Renhuai123/ziwei-doushu \
  -p "*.jsonl.zst" -p "MANIFEST.json" -p "SHA256SUMS.txt"

# 校验
shasum -a 256 -c SHA256SUMS.txt

# 传到服务器
tar -cf - *.zst MANIFEST.json SHA256SUMS.txt | ssh ci199 \
  'cd ~/dev/ziwei-global/data/raw && tar -xf -'

# 服务器端再校验一次
ssh ci199 'cd ~/dev/ziwei-global/data/raw && sha256sum -c SHA256SUMS.txt'
```

### 3.2 装载

```bash
ssh ci199
cd ~/dev/ziwei-global/app
export ZIWEI_DATABASE_URL="postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei"
export ZIWEI_RAW_DIR="/home/ci/dev/ziwei-global/data/raw"

# 全量
bash scripts/ingest/load-all.sh

# 单年
bash scripts/ingest/load-year.sh 1990 "$ZIWEI_RAW_DIR/year-1990.jsonl.zst"
```

**性能要点**：批量阶段先 `DROP` 昂贵的 trgm 索引，插完再 `CREATE INDEX CONCURRENTLY` 重建。
带索引单年要 4m45s，摘掉后 19s —— 全量从 6 小时降到 25 分钟。

**磁盘**：解压产物**不落盘**（`zstd -dc` 流式管道），中间 TSV 用完即删。
56.6 GB 的原始数据只以 155 MB 压缩包形式存在于磁盘。

### 3.3 小节索引（检索加速层）

```bash
psql "$ZIWEI_DATABASE_URL" -f scripts/ingest/split-sections.sql   # 拆小节，约 50 分钟
psql "$ZIWEI_DATABASE_URL" -f scripts/ingest/index-sections.sql   # 建 trgm 索引，约 30 分钟
```

**为什么要这一层**（v4.0 全量实测）：

| 方案 | 实测 | 原因 |
|---|---|---|
| `content ILIKE '%kw%'` | 跨年 > 2 分钟 | 前后都通配时 GIN trgm 索引无法提取 trigram，退化成全表扫描 |
| `content % 'kw'` | 更慢 | 能走索引，但 2.3KB 中文长文本上 trgm 代价极高 |
| **拆小节后检索** | **秒级** | 每行内容变短（平均 ~200 字），索引真正可用 |

拆法：每段解读按 `**【小节标题】**` 前瞻分割。实测 877 万段 → **91,460,638 个小节**
（约 10.4 个/段），小节标题是有限集合（**26 种**）。

小节标题全集（可用于 `heading` 过滤）：

```
命格总览 性格总览 感情总览 事业总览 财运总览 健康总览 兄弟总览 子女总览
迁移总览 人际总览 田宅总览 福德总览 父母总览
一句话定调 核心论断 命盘依据 三方四正联动 命盘推演
身宫 · 后天追求 针对你的命盘 ⚠️ 风险提醒
四化路径分析 · 落到你这盘 四化路径 · 你这盘 年干四化·关键宫位影响
倪师子午流注 · 宫位取象（流派参考） 经典出处
```

---

## 4. 数据库结构

| 表 | 说明 |
|---|---|
| `ziwei_charts` | 命盘主表，一行一张盘。`chart_key` = `YYYY-MM-DD-h-GENDER`（h 为时辰序号 0–11） |
| `ziwei_readings` | 解读表，一行一张盘的一个维度。`(chart_key, topic)` 唯一 |
| `ziwei_ingest_log` | 装载审计：年份、盘数、解读数、源文件 sha256 |

### 时辰序号对照

| 序号 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 时辰 | 子 | 丑 | 寅 | 卯 | 辰 | 巳 | 午 | 未 | 申 | 酉 | 戌 | 亥 |
| 钟点 | 23–1 | 1–3 | 3–5 | 5–7 | 7–9 | 9–11 | 11–13 | 13–15 | 15–17 | 17–19 | 19–21 | 21–23 |

---

## 5. 开发服务器

```bash
ssh ci199
cd ~/dev/ziwei-global/app
npm install
npx next dev -p 3020
```

日志：`~/dev/ziwei-global/logs/next-dev.log`

| 服务 | 地址 |
|---|---|
| 开发站点 | http://192.168.1.199:3020 |
| 健康检查 | http://192.168.1.199:3020/api/health |

---

## 6. API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 库连通性、命盘数、解读段数、年份覆盖 |
| `/api/chart` | POST | 服务端排盘（与前端同一引擎口径） |
| `/api/reading` | GET | 取一张盘的 13 维解读 |
| `/api/search` | GET | 解读小节中文子串检索（pg_trgm，走 `ziwei_sections`） |

示例：

```bash
curl -s -X POST http://127.0.0.1:3020/api/chart -H 'Content-Type: application/json' \
  -d '{"year":1990,"month":1,"day":1,"hour":0,"gender":"male"}'

curl -s "http://127.0.0.1:3020/api/reading?year=1990&month=1&day=1&hour=0&gender=male"

# 检索必须带至少一个过滤条件（全库扫描会超时）
curl -s "http://127.0.0.1:3020/api/search?q=天府&year=1990&limit=5"
curl -s "http://127.0.0.1:3020/api/search?q=天府&yearFrom=2000&yearTo=2005&topic=wealth&limit=5"
curl -s "http://127.0.0.1:3020/api/search?q=太阳&mingzhu=天府&limit=5"
```

过滤参数：`year` / `yearFrom` / `yearTo` / `gender` / `topic` / `heading` / `mingzhu`

---

## 7. CI

| 工作流 | 触发 | 内容 |
|---|---|---|
| `ci.yml` | push / PR | 类型检查 + 全部排盘回归（无数据库，~60s） |
| `ci-db.yml` | 手动 / 每天 03:17 UTC | 真实 Postgres 16 容器：建表 → 造样本 → 数据库层回归（~110s） |

数据库层回归需要表里真有数据，所以用 `scripts/ingest/make-sample.ts` 造一份小样本
（3 年 × 12 时辰 × 2 性别 × 13 维，内容含真实术语，命宫主星由引擎算出）。
这让「引擎口径 ↔ 数据集口径一致」和「术语倒排检索正确」能在每次 CI 里被验证。

```bash
# 本地跑数据库层回归
export DATABASE_URL="postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei_ci_test"
psql ... -c 'CREATE DATABASE ziwei_ci_test;'
psql ... -d ziwei_ci_test -f scripts/ingest/schema.sql
npx tsx scripts/ingest/make-sample.ts
npx tsx scripts/regression/term-search.test.ts
npx tsx scripts/regression/dataset-alignment.test.ts
```

## 8. 生产服务

```bash
sudo cp deploy/ziwei.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ziwei

systemctl status ziwei
curl -s http://127.0.0.1:3020/api/health
```

实测生产环境性能：检索 10–20ms，页面 9–12ms，进程内存 54MB。

## 9. Git 工作流

- 上游仓库 `Renhuai123/ziwei-doushu` —— **只读**，定期 `git fetch upstream` 同步引擎更新
- 我们的仓库 `leonardozhe/ziwei-doushu` —— 唯一开发仓库，服务器直推
- 服务器 SSH deploy key：`~/.ssh/id_ed25519_github`（write 权限），已注册为该仓库的 deploy key

```bash
# 服务器上
cd ~/dev/ziwei-global/app
git pull origin main
```

---

## 8. 备份与恢复

三个脚本都在 `scripts/ops/` 下，都遵循 `set -euo pipefail`，失败时返回明确的非零退出码。

| 脚本 | 作用 |
|---|---|
| `backup-db.sh` | 备份：pg_dump 自定义格式 + 结构/数据分离 + manifest + 校验和 + 保留策略 |
| `restore-db.sh` | 恢复：支持只校验、只恢复结构、只恢复数据、整体恢复 |
| `healthcheck.sh` | 一条命令输出整体健康状态，任何一项不达标就非 0 退出 |

### 8.1 备份产物长什么样

每次备份是一个独立目录，`<备份目录>/ziwei-<时间戳>-<标签>/`：

```
ziwei-20261022-150000-ci199/
├── ziwei.dump        # pg_dump 自定义格式 —— 首选恢复方式（结构+数据一体，支持并行恢复）
├── schema.sql.gz     # 只有结构（表 / 索引 / 扩展 / 约束）
├── data.sql.gz       # 只有数据（COPY 格式）
├── manifest.json     # 机器可读：备份时间、源库大小、各表行数、年份覆盖、各文件 sha256
├── manifest.txt      # 人读版清单
└── SHA256SUMS        # 各文件 sha256，可直接 sha256sum -c
```

**默认备份目录**：`/home/ci/dev/ziwei-global/backups`
**默认保留天数**：14（`ZIWEI_BACKUP_KEEP_DAYS`）
**默认连接串**：`postgresql://ziwei:ziwei_dev_pwd@127.0.0.1:5435/ziwei`（`ZIWEI_DATABASE_URL`）

### 8.2 怎么备份

```bash
ssh ci199
cd ~/dev/ziwei-global/app

# 常规全量备份
bash scripts/ops/backup-db.sh

# 备份并做恢复校验（会临时建一个库 restore 进去比对行数，慢但能证明备份真的可用）
bash scripts/ops/backup-db.sh --verify

# 指定目录和保留天数
bash scripts/ops/backup-db.sh --dir /home/ci/dev/ziwei-global/backups --keep-days 30

# 只备份部分表（支持 glob，用于快速演练）
bash scripts/ops/backup-db.sh --table public.ziwei_charts --verify

# 排除某张表
bash scripts/ops/backup-db.sh --exclude-table public.probe_tsv
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--dir <path>` | 备份输出目录 |
| `--label <name>` | 备份名后缀，默认取主机名 |
| `--verify` | 备份后恢复到临时库并逐表比对行数 |
| `--no-verify` | 跳过校验（默认行为） |
| `--skip-data` / `--skip-schema` | 不导出 data.sql / schema.sql |
| `--table <glob>` / `--exclude-table <glob>` | 表白名单 / 黑名单 |
| `--keep-days <n>` | 保留天数 |
| `--no-prune` | 不清理过期备份 |
| `--keep-verify-db` | 校验后保留临时库（调试用） |

保留策略按**备份名里的时间戳**判断年龄（不是文件 mtime），所以手动改过 mtime 也不会误删。

退出码：`0` 成功 / `2` 参数错误 / `3` 缺依赖 / `4` 连不上库 / `5` 备份失败 / `6` 校验失败。

### 8.3 怎么恢复

```bash
ssh ci199
cd ~/dev/ziwei-global/app

# ① 先只校验，不动数据
bash scripts/ops/restore-db.sh --from /home/ci/dev/ziwei-global/backups/ziwei-20261022-150000-ci199 --verify-only

# ② 恢复到另一个库（演练用，不影响生产库）
bash scripts/ops/restore-db.sh   --from /home/ci/dev/ziwei-global/backups/ziwei-20261022-150000-ci199   --to ziwei_restore_test --yes

# ③ 覆盖式恢复生产库（危险！会 DROP 目标库再重建）
bash scripts/ops/restore-db.sh   --from /home/ci/dev/ziwei-global/backups/ziwei-20261022-150000-ci199   --yes

# ④ 只恢复结构
bash scripts/ops/restore-db.sh --from <目录> --schema-only --prefer-sql --yes

# ⑤ 只恢复数据
bash scripts/ops/restore-db.sh --from <目录> --data-only --prefer-sql --yes

# ⑥ 跳过索引恢复（快得多，索引事后单独建）
bash scripts/ops/restore-db.sh --from <目录> --to ziwei_rehearsal --yes --skip-index
```

要点：

- **`--from` 接受三种形式**：备份目录 / `ziwei.dump` 单文件 / `schema.sql.gz`+`data.sql.gz`。
- **恢复模式自动选择**：目录里有 `ziwei.dump` 时默认走 `pg_restore`（结构+数据一体，dump 自带建表语句）；
  显式加 `--prefer-sql` 才走 `schema.sql` + `data.sql` 路径。两者不会同时跑——
  dump 已经建好表，再灌 `schema.sql` 会撞 `relation already exists`。
- **恢复前自动检查目标库**：存在就先 `DROP DATABASE`（会先踢掉占用连接）再 `CREATE`；
  不存在就新建。`--no-drop` 可以保留目标库，但要求它是空的。
- **恢复后自动核对行数**：拿 `manifest.json` 里的 `row_counts` 逐表比对，不一致就以退出码 6 失败。
- **`--skip-index`**：跳过索引/触发器/外键约束，只灌数据。恢复快数倍，
  代价是索引要事后重建（脚本结束时会打印重建命令）。
- **扩展自动准备**：`pg_dump --table=...` 不会带出 `CREATE EXTENSION`，
  但会带出依赖扩展的索引。脚本在恢复前自动建好 `pg_trgm`，
  否则目标库会因为缺 `gin_trgm_ops` 而恢复失败。
- 不加 `--yes` 会有交互确认。

退出码：`0` 成功 / `2` 参数错误 / `3` 缺依赖 / `4` 连不上库 / `6` 校验失败 / `7` 恢复失败。

### 8.4 恢复演练步骤

每次改数据管线（重建索引、换装载逻辑、升级 Postgres）之前跑一遍：

```bash
# 1. 备份（带校验，顺带证明备份可用）
bash scripts/ops/backup-db.sh --verify

# 2. 恢复到一个临时库
bash scripts/ops/restore-db.sh --from <上一步的备份目录> --to ziwei_rehearsal --yes

# 3. 核对行数（restore 脚本已经自动做，这里再独立查一遍）
export PGPASSWORD=ziwei_dev_pwd
psql -h 127.0.0.1 -p 5435 -U ziwei -d ziwei_rehearsal   -c "SELECT count(*) FROM ziwei_charts"   -c "SELECT count(*) FROM ziwei_readings"   -c "SELECT count(*) FROM ziwei_sections"

# 4. 起一个指向临时库的应用实例做功能抽查
#    （把 DATABASE_URL 的库名换成 ziwei_rehearsal，端口避开 3020）

# 5. 清理
psql -h 127.0.0.1 -p 5435 -U ziwei -d postgres -c "DROP DATABASE ziwei_rehearsal;"
```

演练通过的标准：行数三项与生产库一致 + `/api/health` 返回 `status: ok`。

### 8.5 恢复要多久

**下面是 2026-10-22 在 199 服务器上的实测数据**（Postgres 16.15，容器 2GB shared_buffers /
8GB effective_cache，数据卷在本地 NVMe）。测的是 `ziwei_readings`（877 万行 / 57 GB 原始）整表。

#### 实测基线

| 操作 | 数据量 | 耗时 |
|---|---|---|
| `pg_dump`（`--compress=6`，单表） | 57 GB → 14.4 GB 压缩 | **20 分 45 秒** |
| `pg_restore --jobs=4`（含索引） | 14.4 GB → 41 GB 落库 | 数据 19 分钟 + trgm 索引 **约 2 小时** |
| `pg_restore --jobs=4 --skip-index` | 同上，只灌数据 | **19 分钟**（877 万行全部到位） |
| `pg_dump` + 恢复 + 校验（小表 `ziwei_charts` 67.5 万行） | 123 MB | **< 6 秒** |
| `pg_dump` + 恢复 + 校验（小表 `ziwei_ingest_log` 78 行） | 64 kB | **< 3 秒** |
| 恢复后 `count(*)` 核对 | 877 万行 | **约 1 秒**（走索引） |

#### 结论

| 场景 | 预估耗时 |
|---|---|
| **全量恢复（含全部索引）** | **3 – 4 小时** ← 瓶颈是 trgm 索引，不是数据 |
| **全量恢复（`--skip-index`）+ 事后建索引** | 数据 45–60 分钟 + 索引 2–3 小时 |
| 只恢复结构 | **< 1 分钟** |
| 只恢复数据（`data.sql`） | 60–90 分钟 |
| 恢复 + 行数核对 | 数据部分 + 约 2 分钟 |

**关键结论：恢复慢的不是数据，是索引。**
`ziwei_readings` 的 GIN trgm 索引要在 877 万条中文长文本上建，
实测单独就要 **2 小时以上**（877 万行 × 平均 2.3KB 中文）。
`ziwei_sections`（8269 万行）的 trgm 索引按 DEV-ENV 第 3.3 节记录约 30 分钟。
所以全量恢复的现实答案是 **3–4 小时**，不是「几十分钟」。

#### 恢复演练建议

演练时**不要**追求「完整恢复并建好索引」，那样一次要 3–4 小时，占用生产库 IO。
务实做法：

```bash
# 1. 备份（小范围即可，验证管线）
bash scripts/ops/backup-db.sh --table public.ziwei_charts --verify

# 2. 恢复到临时库，跳过索引（分钟级）
bash scripts/ops/restore-db.sh --from <备份目录> --to ziwei_rehearsal --yes --skip-index

# 3. 核对行数（restore 脚本已自动做，这里独立再查一遍）
psql -h 127.0.0.1 -p 5435 -U ziwei -d ziwei_rehearsal -c "SELECT count(*) FROM ziwei_charts"

# 4. 需要验证检索功能时，再单独建索引（这才是耗时的部分）
psql -h 127.0.0.1 -p 5435 -U ziwei -d ziwei_rehearsal -f scripts/ingest/index-sections.sql

# 5. 清理
psql -h 127.0.0.1 -p 5435 -U ziwei -d postgres -c "DROP DATABASE ziwei_rehearsal;"
```

> 注意：上面的耗时假设磁盘和 IO 没被其它任务占满。
> 若同时在跑 `CREATE INDEX` 或 `pg_dump`，实际耗时会明显变长
> —— 本次基线就是在「另一个 agent 同时在给小节表建 trgm 索引」的情况下测的，属于偏悲观值。

### 8.6 建议的备份策略

| 项 | 建议 |
|---|---|
| 频率 | 每次数据管线变更后立即备份；平时每周一次 |
| 保留 | 14 天（`ZIWEI_BACKUP_KEEP_DAYS`），每月 1 号那次保留 90 天 |
| 异地 | `/home/ci/dev/ziwei-global/backups` 在同一块盘上，**不算真正的备份**。至少每周把备份目录 rsync 到另一台机器或对象存储 |
| 校验 | 每次备份加 `--verify`，证明的不只是文件在，而是真的能恢复 |
| 定时 | 用 systemd timer 或 cron 跑 `backup-db.sh --verify`，结果写日志；连续失败要告警 |

### 8.7 健康检查

```bash
cd ~/dev/ziwei-global/app
bash scripts/ops/healthcheck.sh
```

输出对齐表格，检查项：

| 检查项 | 默认期望 |
|---|---|
| Postgres 容器 | `ziwei-postgres` 处于 running |
| 数据库连接 | 能 SELECT 1 |
| `/api/health` | HTTP 200 且 `status: ok` |
| 命盘数 `ziwei_charts` | 674976 |
| 解读段数 `ziwei_readings` | 8774688 |
| 小节数 `ziwei_sections` | 参考值（不参与判定） |
| 覆盖年份 | 1950–2026，77 年 |
| 磁盘剩余 | ≥ 20 GB（`--min-free-gb` 可调） |

任何一项不达标 → 退出码 **8**。`--json` 输出机器可读汇总（stdout 纯 JSON，日志走 stderr）。

适合挂在监控里：

```bash
bash scripts/ops/healthcheck.sh --json 2>/dev/null | jq -e '.status == "ok"' >/dev/null || echo "紫微算命服务异常"
```

---

## 9. 注意事项

- **数据集口径**：解读是「本命盘视图」，不含按当前年龄改写的句子、倪师法则附加段与 AI 解读；
  按时辰序号直接排盘，**未做出生地真太阳时校正**。
- **倪师原话**（`docs/tianji-ziwei/`）是 CC BY-NC-SA 4.0，**不可商用**；
  数据集解读里引用的倪师原话同样不在数据授权范围内。
- **引擎开源、界面不开源**：上游商业版的完整前端与 AI 解读 prompt 不在开源范围，
  需要我们自己实现（`/api/interpret`）。
