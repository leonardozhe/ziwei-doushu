# 部署文件

| 文件 | 用途 |
|---|---|
| `docker-compose.db.yml` | 解读数据集的 Postgres 16 容器（127.0.0.1:5435） |

应用本身是 Next.js 16，部署时用标准 `next build` + `next start`，
数据库连接串通过 `DATABASE_URL` 注入。
