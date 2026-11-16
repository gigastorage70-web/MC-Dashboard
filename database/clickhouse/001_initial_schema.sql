-- Telecom QoS Intelligence & MediaCore CSV Analytics Platform
-- ClickHouse Initial Analytical Schema (001)
-- Optimized for 2M-10M+ records per dataset on MergeTree with ZSTD compression

CREATE DATABASE IF NOT EXISTS mc_analytics;

-- ============================================================================
-- 1. CORE TRANSACTION TABLE (sms_records)
-- ============================================================================
-- Sorting key prioritizes the highest-frequency filter predicates:
--   dataset_id -> date -> op_name -> tp_name -> normalized_status -> country -> event_timestamp
CREATE TABLE IF NOT EXISTS mc_analytics.sms_records (
    dataset_id UUID,
    upload_id UUID,
    batch_id UInt32,
    message_row_id UInt64,
    row_hash FixedString(32),

    event_timestamp DateTime64(6, 'UTC'),
    dlr_timestamp Nullable(DateTime64(6, 'UTC')),
    dlr_latency_ms Nullable(Int64),

    -- Core Messaging Dimensions
    op_name LowCardinality(String),
    tp_name LowCardinality(String),
    applicant LowCardinality(String),
    direction LowCardinality(String),
    route LowCardinality(String),

    -- Identifiers (Compressed with ZSTD due to higher cardinality)
    op_ani String CODEC(ZSTD(3)),
    tp_ani String CODEC(ZSTD(3)),
    destination_number String CODEC(ZSTD(3)),
    called_number_out String CODEC(ZSTD(3)),
    message_id String CODEC(ZSTD(3)),
    transaction_id String CODEC(ZSTD(3)),

    -- Geography & Telecom Network
    country LowCardinality(String),
    state_region LowCardinality(String),
    raw_country_network LowCardinality(String),
    op_mcc LowCardinality(String),
    op_mnc LowCardinality(String),
    tp_mcc LowCardinality(String),
    tp_mnc LowCardinality(String),

    -- Dual-Stage Status & Rejection Intelligence
    raw_submit_status LowCardinality(String),
    raw_dlr_state LowCardinality(String),
    raw_status LowCardinality(String),
    normalized_status LowCardinality(String), -- SUCCESS | FAILED | REJECTED | PENDING | OTHER | UNKNOWN
    is_terminal UInt8,
    reason LowCardinality(String),
    reason_normalized LowCardinality(String),

    -- Network & Financial Metadata
    op_host LowCardinality(String),
    tp_host LowCardinality(String),
    nas_ip LowCardinality(String),
    op_price Nullable(Decimal(12, 6)),
    tp_price Nullable(Decimal(12, 6)),
    cost_in Nullable(Decimal(12, 6)),
    cost_out Nullable(Decimal(12, 6)),
    op_currency LowCardinality(String),
    tp_currency LowCardinality(String),

    -- Unmapped / Extra MediaCore columns preserved as JSON string
    extra_attributes String CODEC(ZSTD(3)),
    ingested_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_timestamp)
ORDER BY (dataset_id, toDate(event_timestamp), op_name, tp_name, normalized_status, country, event_timestamp, message_row_id)
SETTINGS index_granularity = 8192;

-- ============================================================================
-- 2. IDEMPOTENCY LEDGER FOR CRASH-SAFE BATCH INGESTION
-- ============================================================================
CREATE TABLE IF NOT EXISTS mc_analytics.ingestion_batches (
    upload_id UUID,
    dataset_id UUID,
    batch_id UInt32,
    row_count UInt32,
    committed_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (upload_id, batch_id);

-- ============================================================================
-- 3. HOURLY ROLLUP TABLE & MATERIALIZED VIEW (Sub-second Dashboard Loads)
-- ============================================================================
CREATE TABLE IF NOT EXISTS mc_analytics.sms_hourly_rollup (
    dataset_id UUID,
    bucket_hour DateTime('UTC'),
    op_name LowCardinality(String),
    tp_name LowCardinality(String),
    applicant LowCardinality(String),
    country LowCardinality(String),
    state_region LowCardinality(String),
    route LowCardinality(String),
    raw_status LowCardinality(String),
    normalized_status LowCardinality(String),
    is_terminal UInt8,
    reason_normalized LowCardinality(String),

    total_count UInt64,
    success_count UInt64,
    failed_count UInt64,
    rejected_count UInt64,
    pending_count UInt64,
    unknown_count UInt64,
    other_count UInt64,
    terminal_count UInt64,
    cost_in_sum Decimal(38, 6),
    cost_out_sum Decimal(38, 6),
    dlr_latency_ms_sum Int64,
    dlr_latency_count UInt64
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(bucket_hour)
ORDER BY (
    dataset_id,
    bucket_hour,
    op_name,
    tp_name,
    country,
    normalized_status,
    raw_status,
    route,
    applicant,
    state_region,
    reason_normalized,
    is_terminal
);

CREATE MATERIALIZED VIEW IF NOT EXISTS mc_analytics.sms_hourly_rollup_mv
TO mc_analytics.sms_hourly_rollup
AS
SELECT
    dataset_id,
    toStartOfHour(event_timestamp) AS bucket_hour,
    op_name,
    tp_name,
    applicant,
    country,
    state_region,
    route,
    raw_status,
    normalized_status,
    is_terminal,
    reason_normalized,
    count() AS total_count,
    countIf(normalized_status = 'SUCCESS') AS success_count,
    countIf(normalized_status = 'FAILED') AS failed_count,
    countIf(normalized_status = 'REJECTED') AS rejected_count,
    countIf(normalized_status = 'PENDING') AS pending_count,
    countIf(normalized_status = 'UNKNOWN') AS unknown_count,
    countIf(normalized_status = 'OTHER') AS other_count,
    countIf(is_terminal = 1) AS terminal_count,
    sum(coalesce(toDecimal64(cost_in, 6), toDecimal64(0, 6))) AS cost_in_sum,
    sum(coalesce(toDecimal64(cost_out, 6), toDecimal64(0, 6))) AS cost_out_sum,
    sum(coalesce(dlr_latency_ms, 0)) AS dlr_latency_ms_sum,
    countIf(dlr_latency_ms IS NOT NULL) AS dlr_latency_count
FROM mc_analytics.sms_records
GROUP BY
    dataset_id,
    bucket_hour,
    op_name,
    tp_name,
    applicant,
    country,
    state_region,
    route,
    raw_status,
    normalized_status,
    is_terminal,
    reason_normalized;
