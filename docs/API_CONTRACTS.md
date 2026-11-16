# API Contracts — Telecom QoS Intelligence & MediaCore Analytics Platform

All `/api/*` endpoints (except `/api/health` and `/api/auth/login`) require authenticated session cookies (Auth.js/JWT) and enforce RBAC + Zod request validation.

---

## 1. System & Authentication

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Live latency & status checks for PostgreSQL, ClickHouse, and S3/R2 storage (never exposes secrets) |
| `POST` | `/api/auth/login` | Public | Authenticates user, sets HttpOnly session cookie, logs `audit_logs` |
| `POST` | `/api/auth/logout` | Any | Clears session cookie |
| `GET` | `/api/auth/me` | Any | Returns current user, roles, and persisted `user_preferences` |
| `PATCH` | `/api/preferences` | Any | Updates theme (`light`/`dark`/`system`), PII masking preference, timezone |

---

## 2. Upload, Schema Mapping & Dataset Lifecycle (Phase 3)

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/schema-profiles` | Analyst+ | Lists saved MediaCore schema mapping profiles |
| `POST` | `/api/schema-profiles` | Analyst+ | Creates/updates a reusable CSV-to-logical-field mapping profile |
| `POST` | `/api/uploads/presign` | Analyst+ | Validates file extension/size, creates `datasets` + `upload_jobs` row (`idempotency_key`), returns presigned S3/R2 PUT (or multipart) URL |
| `POST` | `/api/uploads/:jobId/confirm` | Analyst+ | Confirms upload completion, saves confirmed schema mapping, transitions job to `QUEUED`, fires signed worker webhook |
| `GET` | `/api/uploads` | Viewer+ | Lists upload history, 12-stage progress, row counts, durations |
| `GET` | `/api/uploads/:jobId` | Viewer+ | Detailed job status, checkpoints, `processing_logs`, and `data_quality_reports` |
| `GET` | `/api/uploads/:jobId/error-report` | Analyst+ | Generates time-limited presigned download URL for rejected rows CSV |
| `POST` | `/api/uploads/:jobId/retry` | Analyst+ | Resumes failed/partial job safely from `checkpoint_batch_index` |
| `DELETE` | `/api/datasets/:datasetId` | Admin | Safe multi-store deletion (R2 object + ClickHouse partition/rows + PostgreSQL metadata + audit log) |

---

## 3. Centralized Analytics & Global Filter Engine (Phase 4)

All analytics endpoints share the identical `GlobalFilterSpec` query/body contract:
```json
{
  "datasetIds": ["uuid"],
  "dateFrom": "2026-11-13T00:00:00Z",
  "dateTo": "2026-11-13T23:59:59Z",
  "opNames": [],
  "tpNames": [],
  "opAnis": [],
  "tpAnis": [],
  "countries": [],
  "states": [],
  "rawStatuses": [],
  "normalizedStatuses": [],
  "reasons": [],
  "applicants": [],
  "directions": [],
  "routes": [],
  "searchQuery": ""
}
```

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/analytics/kpis` | Global 12 KPI cards + terminal denominator + optional financial/latency summary |
| `POST` | `/api/analytics/facets` | Dependent distinct filter values (`LIMIT 100`, search-filtered) from `sms_hourly_rollup` / `sms_records` |
| `POST` | `/api/analytics/timeseries` | Hourly/15-min bucketed traffic & rate trend |
| `POST` | `/api/analytics/op` | OP-wise breakdown, worst OPs, OPxTP matrix |
| `POST` | `/api/analytics/tp` | TP-wise breakdown, failure contribution %, route breakdown, TP profile |
| `POST` | `/api/analytics/applicant` | Applicant comparison (returns explicit `available: false` if unmapped) |
| `POST` | `/api/analytics/ani` | Independent OP ANI & TP ANI rankings, anomaly flags, PII-masked by role |
| `POST` | `/api/analytics/geography` | Country & MNO network breakdown, unmapped bucket preserved |
| `POST` | `/api/analytics/status-reasons` | Raw status + DLR state + rejection reason distribution & rankings |
| `POST` | `/api/explorer/messages` | Keyset/cursor-paginated (`(event_timestamp, message_row_id)`) transaction explorer |

---

## 4. QoS Intelligence, Comparisons & Exports (Phase 5–6)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/intelligence/compare` | Period-over-period / dataset-over-dataset comparison (enforces compatible coverage checks) |
| `GET` | `/api/intelligence/alerts` | Lists degradation & baseline anomaly alerts with baseline, current value, and affected count |
| `POST` | `/api/intelligence/evaluate` | Evaluates dataset against configured `alert_configurations` (`min_sample_size` guarded) |
| `POST` | `/api/exports` | Queues async CSV/XLSX/PDF report job on worker; returns `report_exports` job ID |
| `GET` | `/api/exports/:exportId/download` | Returns time-limited presigned download URL once complete |
