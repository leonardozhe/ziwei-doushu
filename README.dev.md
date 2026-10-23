# Ziwei Global — 紫微斗数全球化产品

> 上游引擎与数据：[Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu)
> 本仓库是他的 fork，在其之上做**服务端化、国际化、数据入库**三件事。

---

## 这是什么

一个把紫微斗数排盘能力做成**全球可用产品**的工程底座。

上游开源项目给了三样东西：

1. **排盘引擎**（MIT）—— 真太阳时校正、夏令时、闰月四口径、四化飞星、1100+ 行格局库
2. **解读数据集 v4.0**（CC BY 4.0）—— 674,976 张命盘 × 13 维 = 8,774,688 段解读，约 204 亿字
3. **演示前端** —— 最小可运行示例，商业版前端不开源

**本仓库补上的是把它变成产品所缺的那一层：**

| 能力 | 上游状态 | 本仓库 |
|---|---|---|
| 解读数据 | 只有压缩包 | **已全量入库 Postgres**（877 万段，可检索） |
| 排盘能力 | 只在浏览器里跑 | **暴露成 API**，前端/移动端/第三方共用同一口径 |
| 解读读取 | 无 | **`GET /api/reading`** 直接返回 13 维文本 |
| 语义检索 | 无 | **`GET /api/search`** 术语倒排，5–15ms |
| 界面语言 | 纯中文 | **zh/en 双语层**，首页 + 公告弹窗已接入 |
| 健康检查 | 无 | **`GET /api/health`** |

---

## 快速开始

```bash
# 1. 起数据库
docker compose -f deploy/docker-compose.db.yml up -d

# 2. 起应用
npm install
cp .env.example .env.local      # 填 DATABASE_URL
npm run dev

# 3. 验证
curl localhost:3000/api/health
```

完整环境说明见 [`docs/ops/DEV-ENV.md`](./docs/ops/DEV-ENV.md)。

---

## API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 库连通性、命盘数、解读段数、年份覆盖 |
| `/api/chart` | POST | 服务端排盘，返回完整命盘 JSON |
| `/api/reading` | GET | 取一张盘的 13 维解读文本 |
| `/api/search` | GET | 术语倒排检索（5–15ms） |
| `/api/interpret` | POST | AI 命理解读（SSE 流式，含推演过程透传） |

```bash
# 排盘
curl -X POST localhost:3000/api/chart -H 'Content-Type: application/json' \
  -d '{"year":1990,"month":1,"day":1,"hour":0,"gender":"male"}'

# 解读（时辰序号 0-11，子=0）
curl "localhost:3000/api/reading?year=1990&month=1&day=1&hour=0&gender=male"

# 检索（术语走倒排表，毫秒级）
curl "localhost:3000/api/search?q=天府&limit=5"
```

### AI 解读（`/api/interpret`）

```bash
curl -N -X POST localhost:3000/api/interpret \
  -H 'Content-Type: application/json' \
  -d "{\"chart\": <排盘结果>, \"messages\":[{\"role\":\"user\",\"content\":\"我今年适合换工作吗？\"}]}"
```

返回 SSE：

```
data: {"thinking":"先看命宫……"}     ← 推理过程（推理模型才有），前端显示「正在推演」
data: {"delta":{"text":"你的财帛宫……"}}  ← 正式答案
data: [DONE]
```

**关键设计**：服务端把「完整命盘结构」+「数据集 v4.0 里这张盘已定稿的 13 维断语」
一起注入 prompt（按问题挑相关维度，预算 6000 字），
让模型基于倪师体系断语作答而不是自由发挥；并明确要求它
「断语库没覆盖就说明没覆盖，不要编」。

实测（`cc1/deepseek-v4.1-flash`）：首推理约 3.5s，首正文约 10s，全文 1500–2100 字。

### 命盘链接可直接分享

```
/chart?y=1990&m=1&d=1&h=4&g=male
```

`h` 是**时辰序号 0–11**（子=0 … 亥=11），与数据集口径一致，不是钟点。

---

## 检索架构

v4.0 全量 877 万段解读（204 亿字符）上，任意子串检索**无法走索引**——
`ILIKE '%kw%'` 前后都通配时 GIN trgm 提取不到 trigram，实测跨年 6 年范围要 65 秒。

解法是**术语倒排**：命理术语是有限集合（157 个），把「哪张盘提到哪个术语」
预计算成倒排表，检索就是索引扫描。

| 表 | 行数 | 说明 |
|---|---|---|
| `ziwei_charts` | 674,976 | 命盘主表 |
| `ziwei_readings` | 8,774,688 | 解读正文（13 维） |
| `ziwei_sections` | 82,685,950 | 解读小节（26 种标题） |
| `ziwei_terms` | 157 | 命理术语表 |
| `ziwei_term_charts` | 52,573,091 | 术语 → 命盘 倒排 |

---

## 目录

| 路径 | 说明 |
|---|---|
| `lib/ziwei/` | 排盘引擎（上游） |
| `lib/db/` | Postgres 接入层：连接池、13 维定义、检索 |
| `lib/i18n/` | 国际化字典层与 Provider |
| `lib/ai/` | AI 解读：OpenAI 兼容流式客户端 + 命盘 prompt 组装 |
| `lib/ziwei/terms.ts` | 命理术语表（157 个），检索倒排的词表来源 |
| `app/api/` | 排盘 / 解读 / 检索 / 健康检查 |
| `components/DatasetReading.tsx` | 数据集解读面板（确定性，无需 API Key） |
| `scripts/ingest/` | 数据集入库管线 |
| `deploy/` | 数据库 compose |
| `docs/ops/` | 运维文档 |

---

## 数据集

- 来源：<https://github.com/Renhuai123/ziwei-doushu> Release `v4.0-13d`
- 许可：**CC BY 4.0**，商用自由，**唯一要求是保留来源标注**
- 内容版本：`ca268829f7a9`

> **倪师原话**（`docs/tianji-ziwei/`）单独适用 CC BY-NC-SA 4.0，**不可商用**；
> 数据集解读里引用的倪师原话同样不在数据授权范围内。

---

## 致谢与授权

- 代码（`lib/ziwei/`、`app/`、`components/`）：[MIT](./LICENSE)
- 解读数据集 v4.0：CC BY 4.0（见 [DATASET-LICENSE](./DATASET-LICENSE)）
- 古籍原文（骨髓赋、紫微斗数全集/全书）：公有领域
- 倪海厦《天纪》原话：CC BY-NC-SA 4.0（不可商用）
