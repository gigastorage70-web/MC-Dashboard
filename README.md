# Telecom QoS Intelligence & MediaCore CSV Analytics Platform

Enterprise-grade messaging Quality of Service (QoS) intelligence platform engineered to ingest, validate, and analyze **2M–10M+ MediaCore SMS XDR records** on a **Zero-Docker, 100% cardless, \$0/month stack** with seamless cloud scale-up readiness.

## Current Phase Progress

- [x] **Phase 1 — Architecture & Planning:** Empirical audit of `xdr_all_tps.csv`, Technical Blueprint ([`docs/ARCHITECTURE_BLUEPRINT.md`](docs/ARCHITECTURE_BLUEPRINT.md)), API Contracts, Logical Data Model, SQLite/DuckDB & PostgreSQL/ClickHouse schemas.
- [x] **Phase 2 — Project Foundation:** Zero-Docker embedded runtime (`node:sqlite` + `DuckDB` + local presigned vault), scrypt + JWT Auth/RBAC, User Preferences, Settings, App Shell, Light/Dark mode.
- [x] **Phase 3 — CSV Upload & Streaming Ingestion Engine:** 64 KB header probe & dynamic schema mapper, reusable schema profiles, direct presigned upload, bounded-memory `csv-parse` worker with batch checkpoint recovery & downloadable error CSV reports.
- [x] **Phase 4 — Centralized Analytics Engine & Filter API:** Dual-dialect DuckDB/ClickHouse query builder, `sms_hourly_rollup` routing, dependent facet dropdowns, centralized status/rate formulas.
- [x] **Phase 5 — Interactive ECharts Dashboard & Message Explorer:** Overview (12 KPIs + time series), OP, TP, Applicant, ANI, Geographic, Rejection Intelligence, keyset-cursor Message Explorer, Upload History, and Reports.
- [x] **Phase 6 — QoS Intelligence:** Period/Dataset comparison, baseline degradation & anomaly scan (`min_sample_size` guarded), Alert Acknowledge/Resolve workflow, and Investigation Notes.
- [x] **Phase 7 — Unit, Integration & Synthetic Benchmark Suite:** Vitest unit tests + real 157.9 MB CSV end-to-end ingestion & query verification + 100K–10M synthetic CSV generator.

## Zero-Docker \$0 Architecture (Single-Command Launch)

| Layer | Zero-Docker Default (\$0, No External Services) | Optional Cloud Scale-Up (Swap via `.env`) |
|---|---|---|
| **Frontend & BFF** | Next.js 15 App Router + Apache ECharts + TanStack | Vercel / Container Cluster |
| **App Metadata & Queue** | Built-in `node:sqlite` (WAL mode, zero install) | Neon / Managed PostgreSQL |
| **Columnar Analytics** | Embedded **DuckDB** (columnar OLAP via Worker HTTP bridge) | ClickHouse Cloud |
| **Object Storage** | Local Presigned Streaming Vault (`./data/storage`) | Cloudflare R2 / Tigris |
| **CSV Ingestion** | Dedicated Node.js streaming worker (`csv-parse`, bounded memory) | Persistent Worker Container |

## Quick Start (Zero Docker, 1 Command)

1. Ensure `.env` exists (created from `.env.example`):
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   npm --prefix worker install
   ```
3. Launch both the Next.js dashboard and the DuckDB streaming worker in one command:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`, create your initial Admin account on the first-run screen, go to **Upload CSV**, and upload `xdr_all_tps.csv`.

## Verification & Testing

- Run typechecks, unit tests, and 157.9 MB real CSV tests:
  ```bash
  npm run typecheck
  npm --prefix worker run typecheck
  npm test
  ```
- Generate synthetic benchmark datasets (100K–10M rows):
  ```bash
  npx tsx tests/performance/generate-synthetic-mediacore.ts --rows 1000000 --out tmp/bench_1m.csv
  ```
