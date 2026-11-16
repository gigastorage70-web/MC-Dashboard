# Deploying on Vercel + Cloudflare R2 ($0 Free Tier)

> **Important Serverless Reality:** Vercel hosts the Next.js UI & REST BFF APIs cleanly (4.5 MB payload cap, 10–60s serverless timeout, stateless filesystem). Because 50–200 MB CSVs and 2M–10M-row analytical databases cannot persist inside Vercel's ephemeral filesystem, a live Vercel deployment requires **3 connections** (all available at \$0/month):

1. **PostgreSQL (`DATABASE_URL`) — 1-Click in Vercel Marketplace (Neon Free, \$0, no card):**
   - In your Vercel Project -> **Storage** -> **Create Database** -> **Neon Serverless Postgres**.
   - Vercel injects `DATABASE_URL` automatically, and this app auto-runs `database/postgres/001_initial_schema.sql` on first request.
2. **Cloudflare R2 (`STORAGE_PROVIDER=r2`) — 10 GB Free, \$0 Egress:**
   - Create an R2 bucket (e.g. `mc-csv-uploads`) and an R2 API Token (Object Read & Write).
   - Add this **CORS Policy** on your R2 bucket so browser direct `PUT` uploads work from Vercel:
     ```json
     [
       {
         "AllowedOrigins": ["https://*.vercel.app", "http://localhost:3000"],
         "AllowedMethods": ["GET", "PUT", "HEAD"],
         "AllowedHeaders": ["*"],
         "MaxAgeSeconds": 3600
       }
     ]
     ```
   - Set in Vercel Environment Variables:
     - `AUTH_SECRET` (random 32+ char hex string)
     - `STORAGE_PROVIDER=r2`
     - `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
     - `S3_REGION=auto`
     - `S3_BUCKET=mc-csv-uploads`
     - `S3_ACCESS_KEY_ID=<your-r2-access-key>`
     - `S3_SECRET_ACCESS_KEY=<your-r2-secret-key>`
     - `S3_FORCE_PATH_STYLE=false`
3. **Streaming Worker + Analytical DB (`DUCKDB_SERVER_URL` & `WORKER_WEBHOOK_URL`):**
   - Run the worker (`npm run worker:start`) either on a cloud container or directly on your workstation exposed via one free **Cloudflare Tunnel** (`cloudflared tunnel --url http://127.0.0.1:4001`).
   - Give the worker the same `DATABASE_URL`, `S3_*`, and `WORKER_WEBHOOK_SECRET`, and set `DUCKDB_SERVER_URL=https://<tunnel-url>` and `WORKER_WEBHOOK_URL=https://<tunnel-url>/trigger` in Vercel.
   - *(Alternatively, if you don't want to manage Cloudflare R2 + Neon + Tunnel for Vercel, running `npm run build && npm run start` locally with a single `cloudflared tunnel --url http://localhost:3000` serves the entire app over HTTPS with zero external setup.)*
