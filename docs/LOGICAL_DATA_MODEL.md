# Logical Data Model & Security Architecture

## 1. Logical Field Mapping Registry

Every uploaded CSV maps source headers onto canonical logical fields. Required fields prevent ingestion if missing/ambiguous; optional fields gracefully disable dependent charts (`N/A`) rather than failing ingestion.

| Logical Field | Requirement | MediaCore `xdr_all_tps.csv` Column | ClickHouse Column | Analytical Role |
|---|---|---|---|---|
| `MESSAGE_TIMESTAMP` | **Required** | `Send Time` | `event_timestamp` | Time-series bucket, retention, period comparisons |
| `OP_NAME` | **Required** (or `TP_NAME`) | `OP Name` | `op_name` | Originating Partner / Customer QoS |
| `TP_NAME` | **Required** (or `OP_NAME`) | `TP Name` | `tp_name` | Termination Provider / Vendor QoS |
| `SUBMIT_STATUS` | **Conditional** (`SUBMIT_STATUS` or `DLR_STATE`) | `Status` | `raw_submit_status` | Submit-stage SMPP error (`69`, `11`, `88`) |
| `DLR_STATE` | **Conditional** | `State` | `raw_dlr_state` | Final DLR state (`DELIVRD`, `UNDELIV`, `REJECTD`, `ENROUTE`, `EXPIRED`) |
| `OP_ANI` | Optional | `OP ANI` | `op_ani` | Originator / Sender ID analysis |
| `TP_ANI` | Optional | `TP ANI` | `tp_ani` | Terminated Sender ID analysis |
| `COUNTRY` | Optional | `Country` | `raw_country_network`, `country` | Geography & MNO network breakdown |
| `STATE_REGION` | Optional | *(unmapped in sample)* | `state_region` | Sub-national region when exported |
| `MESSAGE_REASON` | Optional | *(unmapped in sample)* | `reason`, `reason_normalized` | Rejection error description |
| `APPLICANT` | Optional | *(unmapped in sample)* | `applicant` | Business applicant (distinct from TP) |
| `DIRECTION` | Optional | *(unmapped in sample)* | `direction` | MT / MO / Inbound / Outbound |
| `ROUTE` | Optional | `Dialpeer` | `route` | Routing dialpeer / LCR profile |
| `DESTINATION` | Optional | `Clear Number` | `destination_number` | Normalized destination MSISDN (maskable) |
| `CALLED_NUMBER_OUT` | Optional | `Called Number OUT` | `called_number_out` | Outbound destination sent to TP (maskable) |
| `MESSAGE_ID` | Optional | `Message ID` | `message_id` | Vendor SMSC tracking ID |
| `TRANSACTION_ID` | Optional | *(unmapped in sample)* | `transaction_id` | Correlation transaction reference |
| `DLR_TIMESTAMP` | Optional | `DLR time` | `dlr_timestamp`, `dlr_latency_ms` | DLR arrival & delivery latency |
| `OP_MCC` / `OP_MNC` / `TP_MCC` / `TP_MNC` | Optional | `OP MCC`, `OP MNC`, `TP MCC`, `TP MNC` | `op_mcc`, `op_mnc`, `tp_mcc`, `tp_mnc` | MCC/MNC carrier enrichment |
| `OP_PRICE` / `TP_PRICE` / `COST_IN` / `COST_OUT` | Optional | `OP Price`, `TP Price`, `Cost IN`, `Cost OUT` | `op_price`, `tp_price`, `cost_in`, `cost_out` | Margin & unbilled-submit leakage |
| `OP_HOST` / `TP_HOST` / `NAS_IP` | Optional | `OP Host`, `TP Host`, `NAS IP` | `op_host`, `tp_host`, `nas_ip` | Switch / SMPP peer IP diagnostics |

---

## 2. Security & Privacy Model

- **Credential Isolation:** PostgreSQL (`DATABASE_URL`), ClickHouse (`CLICKHOUSE_PASSWORD`), Storage (`S3_SECRET_ACCESS_KEY`), and `AUTH_SECRET` remain strictly server-side; zero `NEXT_PUBLIC_*` secret variables.
- **SQL Parameterization:** All PostgreSQL queries use `$1, $2` bind parameters (`pg`); all ClickHouse queries use native named `{param:Type}` bindings (`@clickhouse/client`) — never string-concatenated filters.
- **RBAC Matrix:**
  - `admin`: Full control including dataset deletion, user/role assignment, status rule edits.
  - `analyst`: Upload CSVs, manage schema profiles, save shared filters, export CSV/XLSX/PDF, create alert rules.
  - `operator`: Read dashboards, inspect unmasked ANIs (`pii:read`), post investigation notes.
  - `viewer`: Read dashboards and masked identifiers (`98911***774`).
- **Upload & Export Safety:**
  - Upload presigning verifies file extension (`.csv` / `.csv.gz`), byte size caps, and per-user rate limits; worker checks actual text/CSV structure before ingestion.
  - CSV exports sanitize every cell (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`) to neutralize spreadsheet formula injection.
- **Audit Logging:** Every authentication event, upload initiation, schema profile change, export request, and dataset deletion is recorded in `audit_logs`.
