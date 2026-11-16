-- Telecom QoS Intelligence & MediaCore CSV Analytics Platform
-- PostgreSQL Initial Schema Migration (001)
-- Compatible with PostgreSQL 15+ and Neon Serverless Free Tier

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. AUTHENTICATION & RBAC
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    mask_pii_default BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
    id SMALLSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

-- ============================================================================
-- 2. SCHEMA MAPPING PROFILES & STATUS CLASSIFICATION RULES
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    delimiter VARCHAR(8) NOT NULL DEFAULT ';',
    has_header BOOLEAN NOT NULL DEFAULT TRUE,
    skip_repeated_headers BOOLEAN NOT NULL DEFAULT TRUE,
    timestamp_format VARCHAR(100),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES schema_profiles(id) ON DELETE CASCADE,
    csv_column_name VARCHAR(255) NOT NULL,
    logical_field VARCHAR(100) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    transform_rule VARCHAR(100),
    priority SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, csv_column_name, logical_field)
);

CREATE INDEX IF NOT EXISTS idx_schema_mappings_profile_id ON schema_mappings(profile_id);

CREATE TABLE IF NOT EXISTS status_classification_rules (
    id SERIAL PRIMARY KEY,
    rule_name VARCHAR(150) NOT NULL,
    match_submit_status VARCHAR(100), -- NULL = wildcard, '' = empty string
    match_dlr_state VARCHAR(100),     -- NULL = wildcard, '' = empty string
    normalized_status VARCHAR(20) NOT NULL CHECK (
        normalized_status IN ('SUCCESS', 'FAILED', 'REJECTED', 'PENDING', 'OTHER', 'UNKNOWN')
    ),
    is_terminal BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    priority SMALLINT NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. DATASETS, UPLOAD JOBS, CHECKPOINTS & QUALITY REPORTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    source_system VARCHAR(100) NOT NULL DEFAULT 'MediaCore',
    schema_profile_id UUID REFERENCES schema_profiles(id) ON DELETE SET NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'UPLOADING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'ARCHIVED', 'DELETING')
    ),
    coverage_start TIMESTAMPTZ,
    coverage_end TIMESTAMPTZ,
    total_rows BIGINT NOT NULL DEFAULT 0,
    valid_rows BIGINT NOT NULL DEFAULT 0,
    invalid_rows BIGINT NOT NULL DEFAULT 0,
    duplicate_rows BIGINT NOT NULL DEFAULT 0,
    skipped_rows BIGINT NOT NULL DEFAULT 0,
    available_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_datasets_status ON datasets(status);
CREATE INDEX IF NOT EXISTS idx_datasets_coverage ON datasets(coverage_start, coverage_end);

CREATE TABLE IF NOT EXISTS upload_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    file_name VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    file_sha256 CHAR(64),
    storage_provider VARCHAR(32) NOT NULL DEFAULT 'r2',
    storage_bucket VARCHAR(128) NOT NULL,
    storage_key TEXT NOT NULL,
    is_compressed BOOLEAN NOT NULL DEFAULT FALSE,
    schema_profile_id UUID REFERENCES schema_profiles(id) ON DELETE SET NULL,
    custom_mapping_override JSONB,
    -- 12-stage processing lifecycle
    stage SMALLINT NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 12),
    stage_label VARCHAR(80) NOT NULL DEFAULT 'Upload initiated',
    progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    -- Queue & recovery fields (supports PG SKIP LOCKED or BullMQ)
    queue_status VARCHAR(30) NOT NULL DEFAULT 'QUEUED' CHECK (
        queue_status IN ('AWAITING_UPLOAD', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')
    ),
    attempt_count SMALLINT NOT NULL DEFAULT 0,
    max_attempts SMALLINT NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    locked_by VARCHAR(128),
    locked_at TIMESTAMPTZ,
    checkpoint_row_offset BIGINT NOT NULL DEFAULT 0,
    checkpoint_batch_index INTEGER NOT NULL DEFAULT 0,
    rows_processed BIGINT NOT NULL DEFAULT 0,
    rows_inserted BIGINT NOT NULL DEFAULT 0,
    rows_rejected BIGINT NOT NULL DEFAULT 0,
    rows_skipped BIGINT NOT NULL DEFAULT 0,
    error_code VARCHAR(80),
    error_message TEXT,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_dataset_id ON upload_jobs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_queue_poll ON upload_jobs(queue_status, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS processing_logs (
    id BIGSERIAL PRIMARY KEY,
    upload_job_id UUID NOT NULL REFERENCES upload_jobs(id) ON DELETE CASCADE,
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    level VARCHAR(16) NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
    stage SMALLINT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_logs_job_id ON processing_logs(upload_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_quality_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_job_id UUID NOT NULL UNIQUE REFERENCES upload_jobs(id) ON DELETE CASCADE,
    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    total_rows_detected BIGINT NOT NULL DEFAULT 0,
    valid_rows BIGINT NOT NULL DEFAULT 0,
    invalid_rows BIGINT NOT NULL DEFAULT 0,
    duplicate_rows BIGINT NOT NULL DEFAULT 0,
    rows_skipped BIGINT NOT NULL DEFAULT 0,
    repeated_header_rows BIGINT NOT NULL DEFAULT 0,
    missing_critical_fields BIGINT NOT NULL DEFAULT 0,
    unknown_status_rows BIGINT NOT NULL DEFAULT 0,
    malformed_timestamps BIGINT NOT NULL DEFAULT 0,
    unrecognized_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    mapped_columns JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_report_storage_key TEXT,
    processing_duration_ms INTEGER,
    final_status VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. SAVED FILTERS, PREFERENCES, ALERTS, NOTES, EXPORTS & AUDIT LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    filter_payload JSONB NOT NULL,
    share_token VARCHAR(64) UNIQUE,
    is_shared BOOLEAN NOT NULL DEFAULT FALSE,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_owner ON saved_filters(owner_id);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme VARCHAR(16) NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    default_dataset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    mask_sensitive_identifiers BOOLEAN NOT NULL DEFAULT FALSE,
    default_page_size SMALLINT NOT NULL DEFAULT 50,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    dimension_type VARCHAR(40) NOT NULL CHECK (
        dimension_type IN ('GLOBAL', 'OP', 'TP', 'APPLICANT', 'COUNTRY', 'ANI', 'ROUTE', 'REASON')
    ),
    dimension_filter VARCHAR(255),
    metric_name VARCHAR(60) NOT NULL DEFAULT 'combined_unsuccessful_rate',
    min_sample_size INTEGER NOT NULL DEFAULT 500,
    warning_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    critical_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 25.00,
    delta_spike_pct NUMERIC(5,2) NOT NULL DEFAULT 8.00,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS degradation_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_config_id UUID REFERENCES alert_configurations(id) ON DELETE SET NULL,
    dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    dimension_type VARCHAR(40) NOT NULL,
    dimension_value VARCHAR(255) NOT NULL,
    what_changed TEXT NOT NULL,
    detected_window_start TIMESTAMPTZ,
    detected_window_end TIMESTAMPTZ,
    baseline_value NUMERIC(10,4),
    current_value NUMERIC(10,4),
    affected_records BIGINT NOT NULL DEFAULT 0,
    suggested_investigation TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_degradation_alerts_status ON degradation_alerts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS investigation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    filter_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    dimension_tag VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    report_type VARCHAR(60) NOT NULL,
    format VARCHAR(12) NOT NULL CHECK (format IN ('CSV', 'XLSX', 'PDF')),
    filter_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'QUEUED' CHECK (
        status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED')
    ),
    row_count BIGINT DEFAULT 0,
    file_size_bytes BIGINT DEFAULT 0,
    storage_key TEXT,
    expires_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(80) NOT NULL,
    resource_id VARCHAR(128),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);

-- ============================================================================
-- 5. SEED DATA (ROLES, DEFAULT MEDIACORE XDR PROFILE, STATUS RULES)
-- ============================================================================

INSERT INTO roles (name, description, permissions) VALUES
    ('admin', 'Full platform administration, user management, rules, and deletion', '["*"]'::jsonb),
    ('analyst', 'Upload CSVs, build analytics, save presets, export reports, manage alerts', '["datasets:read","datasets:write","analytics:read","exports:write","notes:write"]'::jsonb),
    ('operator', 'Investigate QoS metrics, inspect unmasked ANIs, add operational notes', '["datasets:read","analytics:read","notes:write","pii:read"]'::jsonb),
    ('viewer', 'Read-only access to dashboards with masked sensitive identifiers', '["datasets:read","analytics:read"]'::jsonb)
ON CONFLICT (name) DO NOTHING;

INSERT INTO schema_profiles (id, name, description, delimiter, has_header, skip_repeated_headers, is_default)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'MediaCore XDR Standard Export (Semicolon)',
    'Verified against MediaCore xdr_all_tps.csv 27-column semicolon export',
    ';',
    TRUE,
    TRUE,
    TRUE
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO schema_mappings (profile_id, csv_column_name, logical_field, is_required, priority) VALUES
    ('11111111-1111-4111-8111-111111111111', 'OP Name', 'OP_NAME', TRUE, 1),
    ('11111111-1111-4111-8111-111111111111', 'TP Name', 'TP_NAME', TRUE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Send Time', 'MESSAGE_TIMESTAMP', TRUE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Clear Number', 'DESTINATION', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Called Number OUT', 'CALLED_NUMBER_OUT', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Country', 'COUNTRY', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'OP MCC', 'OP_MCC', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'OP MNC', 'OP_MNC', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'TP MCC', 'TP_MCC', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'TP MNC', 'TP_MNC', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'OP ANI', 'OP_ANI', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'TP ANI', 'TP_ANI', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Status', 'SUBMIT_STATUS', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'DLR', 'DLR_FLAG', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'DLR time', 'DLR_TIMESTAMP', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'State', 'DLR_STATE', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'OP Price', 'OP_PRICE', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'TP Price', 'TP_PRICE', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Cost IN', 'COST_IN', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Cost OUT', 'COST_OUT', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'OP Host', 'OP_HOST', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'TP Host', 'TP_HOST', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'NAS IP', 'NAS_IP', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Dialpeer', 'ROUTE', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'Message ID', 'MESSAGE_ID', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'OP Currency', 'OP_CURRENCY', FALSE, 1),
    ('11111111-1111-4111-8111-111111111111', 'TP Currency', 'TP_CURRENCY', FALSE, 1)
ON CONFLICT DO NOTHING;

-- Default MediaCore Status + DLR State Classification Rules
INSERT INTO status_classification_rules (rule_name, match_submit_status, match_dlr_state, normalized_status, is_terminal, description, priority) VALUES
    ('DLR Delivered', '', 'DELIVRD', 'SUCCESS', TRUE, 'Accepted by TP and delivered to handset', 10),
    ('DLR Undelivered', '', 'UNDELIV', 'FAILED', TRUE, 'Accepted by TP but failed downstream delivery', 20),
    ('DLR Expired', '', 'EXPIRED', 'FAILED', TRUE, 'Message validity period expired before delivery', 21),
    ('DLR Rejected', '', 'REJECTD', 'REJECTED', TRUE, 'Rejected at downstream SMSC/carrier in DLR', 22),
    ('DLR Enroute/Pending', '', 'ENROUTE', 'PENDING', FALSE, 'Accepted and awaiting final delivery receipt', 30),
    ('DLR Accepted Pending', '', 'ACCEPTD', 'PENDING', FALSE, 'Accepted by downstream entity, final state pending', 31),
    ('Submitted No DLR State', '', '', 'UNKNOWN', FALSE, 'Accepted by TP (empty Status) but no DLR State reported', 40),
    ('SMPP Submit Error (Any non-empty Status)', '*', '', 'REJECTED', TRUE, 'Rejected/failed at submit_sm_resp stage (e.g. 69, 11, 88)', 50)
ON CONFLICT DO NOTHING;
