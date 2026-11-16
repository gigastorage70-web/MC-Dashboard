# Zero-Docker, 100% Cardless & Free (\$0/Month) Deployment Guide

Designed for **1–2 operations users** uploading **4–30 MediaCore CSVs/day (50–200 MB each)** with **zero Docker, zero credit cards, zero cloud subscriptions, and single-command startup**.

---

## Default Mode: Zero-Docker Native Stack (`npm run dev` / `npm start`)

- **Application Metadata & Queue (`APP_DB_MODE=sqlite`):** Uses Node.js 24 built-in `node:sqlite` in WAL mode (`./data/app.sqlite`) — zero installation or background daemon needed.
- **Columnar OLAP Database (`ANALYTICS_ENGINE=duckdb`):** Uses embedded DuckDB (`./data/analytics.duckdb`) inside the dedicated worker process (`@duckdb/node-api` `Appender` bulk inserts + columnar aggregations + `sms_hourly_rollup`).
- **Presigned File Storage (`STORAGE_PROVIDER=local`):** HMAC-signed streaming upload/download endpoints stream CSVs straight to `./data/storage` without buffering files in RAM.
- **Cost:** **\$0.00/month**, zero Docker overhead, zero cloud storage limits, handles 4–30 × 200 MB files/day natively on local SSD.

---

## Optional Remote Access (\$0, Cardless)

If you want to access your local dashboard from another computer or phone over HTTPS:
1. Run `npm run build` then `npm run start` on your host PC.
2. Start a single free **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:3000`) — zero credit card, zero Neon/Tigris/Render accounts needed.

---

## Future Enterprise Scale-Up (Zero Code Rewrite)

When moving to a multi-team cloud environment with budget, update `.env` to activate the built-in cloud adapters:
- `APP_DB_MODE=postgres` + `DATABASE_URL=...` (uses [database/postgres/001_initial_schema.sql](../database/postgres/001_initial_schema.sql))
- `ANALYTICS_ENGINE=clickhouse` + `CLICKHOUSE_URL=...` (uses [database/clickhouse/001_initial_schema.sql](../database/clickhouse/001_initial_schema.sql))
- `STORAGE_PROVIDER=r2` + `S3_ENDPOINT=...`
