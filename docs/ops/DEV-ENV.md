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

## 7. Git 工作流

- 上游仓库 `Renhuai123/ziwei-doushu` —— **只读**，定期 `git fetch upstream` 同步引擎更新
- 我们的仓库 `leonardozhe/ziwei-doushu` —— 唯一开发仓库，服务器直推
- 服务器 SSH deploy key：`~/.ssh/id_ed25519_github`（write 权限），已注册为该仓库的 deploy key

```bash
# 服务器上
cd ~/dev/ziwei-global/app
git pull origin main
```

---

## 8. 注意事项

- **数据集口径**：解读是「本命盘视图」，不含按当前年龄改写的句子、倪师法则附加段与 AI 解读；
  按时辰序号直接排盘，**未做出生地真太阳时校正**。
- **倪师原话**（`docs/tianji-ziwei/`）是 CC BY-NC-SA 4.0，**不可商用**；
  数据集解读里引用的倪师原话同样不在数据授权范围内。
- **引擎开源、界面不开源**：上游商业版的完整前端与 AI 解读 prompt 不在开源范围，
  需要我们自己实现（`/api/interpret`）。
