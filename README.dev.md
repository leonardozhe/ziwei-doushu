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
| 语义检索 | 无 | **`GET /api/search`** pg_trgm 中文子串检索 |
| 界面语言 | 纯中文 | **zh/en 双语层**，可加语种 |
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
| `/api/search` | GET | 解读正文中文子串检索 |

```bash
# 排盘
curl -X POST localhost:3000/api/chart -H 'Content-Type: application/json' \
  -d '{"year":1990,"month":1,"day":1,"hour":0,"gender":"male"}'

# 解读（时辰序号 0-11，子=0）
curl "localhost:3000/api/reading?year=1990&month=1&day=1&hour=0&gender=male"

# 检索
curl "localhost:3000/api/search?q=天府&limit=5"
```

---

## 目录

| 路径 | 说明 |
|---|---|
| `lib/ziwei/` | 排盘引擎（上游） |
| `lib/db/` | Postgres 接入层：连接池、13 维定义、检索 |
| `lib/i18n/` | 国际化字典层与 Provider |
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
