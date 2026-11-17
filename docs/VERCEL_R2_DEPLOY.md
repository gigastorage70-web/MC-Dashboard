# Cloud-Only $0 Deployment Guide (Vercel + Neon + Tinybird)

Deploy the entire MediaCore QoS platform with **zero local workstation running** on a **100% cardless free stack**:

| Layer | Free Service ($0, No Card) | Limits & Capacity |
|---|---|---|
| **Web UI & REST APIs** | **Vercel Hobby** | Next.js App Router, 100 GB bandwidth |
| **PostgreSQL & CSV Object Vault** | **Neon Free** (`winter-queen-87668293`) | `1 GB` Postgres + `5 GB` S3 Object Storage (`mc-csv-uploads`) |
| **Streaming CSV Ingestion Worker** | **Neon Functions** (`functions/csvworker/index.ts`) | `2048 MiB` RAM, **15-min** `waitUntil` streaming budget |
| **Columnar Analytical Database** | **Tinybird Free** (Managed ClickHouse) | `10 GB` storage, `1,000` read requests/day, HTTP `/v0/events` + `/v0/sql` |

---

## Setup Steps

1. **Create a Free Tinybird Account & Workspace** (no credit card required):
   - Sign up at <https://cloud.tinybird.co>.
   - Copy your workspace **Admin Token** (starts with `p.eyJ...`) and regional API host (for example `https://api.tinybird.co` or `https://api.us-east.tinybird.co`).
2. **Create the Tinybird Data Sources (`sms_records`, `sms_hourly_rollup`, `ingestion_batches`):**
   - Put `TINYBIRD_API_URL` and `TINYBIRD_TOKEN` into `.env.local` (or `.env`), then run:
     ```bash
     npm run tinybird:setup
     ```
   - *(If your Tinybird workspace is on Forward deployment mode, install the Tinybird CLI and run `tb --cloud deploy` using `tinybird.config.json` and `tinybird/datasources/*.datasource`.)*
3. **Deploy the Neon Function Worker (`csvworker`):**
   ```bash
   neon deploy --env .env.local
   ```
   Retrieve its URL with `neon functions get csvworker` (e.g. `https://<branch-id>-csvworker.compute.<region>.aws.neon.tech`).
4. **Configure Vercel Environment Variables & Redeploy:**
   - `ANALYTICS_ENGINE=tinybird`
   - `TINYBIRD_API_URL=https://api.tinybird.co` (matching your Tinybird region)
   - `TINYBIRD_TOKEN=<your-tinybird-admin-or-rw-token>`
   - `WORKER_WEBHOOK_URL=https://<branch-id>-csvworker.compute.<region>.aws.neon.tech/trigger`
   - `WORKER_WEBHOOK_SECRET=<matching-secret-set-on-neon-function>`
   - Keep your existing Neon Postgres (`DATABASE_URL`), Neon Object Storage (`AWS_*`, `STORAGE_PROVIDER=neon`, `S3_BUCKET=mc-csv-uploads`), and `AUTH_SECRET` vars.
5. Verify `<vercel-url>/api/health` returns `200 healthy` for `appDb`, `analyticsDb` (`engine: "tinybird"`), and `storage`.

> **Optional Scale-Up:** If you outgrow Tinybird Free, set `ANALYTICS_ENGINE=clickhouse` with `CLICKHOUSE_URL` (and optionally `STORAGE_PROVIDER=r2` with Cloudflare R2 credentials) without touching any UI or query code.
