-- Telecom QoS Intelligence & MediaCore CSV Analytics Platform
-- DuckDB Columnar Analytical Schema (Zero-Docker Default)

CREATE TABLE IF NOT EXISTS sms_records (
    dataset_id VARCHAR,
    upload_id VARCHAR,
    batch_id UINTEGER,
    message_row_id UBIGINT,
    row_hash VARCHAR,

    event_timestamp TIMESTAMP,
    dlr_timestamp TIMESTAMP,
    dlr_latency_ms BIGINT,

    op_name VARCHAR,
    tp_name VARCHAR,
    applicant VARCHAR,
    direction VARCHAR,
    route VARCHAR,

    op_ani VARCHAR,
    tp_ani VARCHAR,
    destination_number VARCHAR,
    called_number_out VARCHAR,
    message_id VARCHAR,
    transaction_id VARCHAR,

    country VARCHAR,
    state_region VARCHAR,
    raw_country_network VARCHAR,
    op_mcc VARCHAR,
    op_mnc VARCHAR,
    tp_mcc VARCHAR,
    tp_mnc VARCHAR,

    raw_submit_status VARCHAR,
    raw_dlr_state VARCHAR,
    raw_status VARCHAR,
    normalized_status VARCHAR,
    is_terminal UTINYINT,
    reason VARCHAR,
    reason_normalized VARCHAR,

    op_host VARCHAR,
    tp_host VARCHAR,
    nas_ip VARCHAR,
    op_price DOUBLE,
    tp_price DOUBLE,
    cost_in DOUBLE,
    cost_out DOUBLE,
    op_currency VARCHAR,
    tp_currency VARCHAR,

    extra_attributes VARCHAR,
    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingestion_batches (
    upload_id VARCHAR,
    dataset_id VARCHAR,
    batch_id UINTEGER,
    row_count UINTEGER,
    committed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sms_hourly_rollup (
    dataset_id VARCHAR,
    bucket_hour TIMESTAMP,
    op_name VARCHAR,
    tp_name VARCHAR,
    applicant VARCHAR,
    country VARCHAR,
    state_region VARCHAR,
    route VARCHAR,
    raw_status VARCHAR,
    normalized_status VARCHAR,
    is_terminal UTINYINT,
    reason_normalized VARCHAR,

    total_count UBIGINT,
    success_count UBIGINT,
    failed_count UBIGINT,
    rejected_count UBIGINT,
    pending_count UBIGINT,
    unknown_count UBIGINT,
    other_count UBIGINT,
    terminal_count UBIGINT,
    cost_in_sum DOUBLE,
    cost_out_sum DOUBLE,
    dlr_latency_ms_sum BIGINT,
    dlr_latency_count UBIGINT
);
