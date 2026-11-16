-- Telecom QoS Intelligence & MediaCore CSV Analytics Platform
-- SQLite Initial Application Schema (Zero-Docker Default)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    mask_pii_default INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    permissions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS schema_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    delimiter TEXT NOT NULL DEFAULT ';',
    has_header INTEGER NOT NULL DEFAULT 1,
    skip_repeated_headers INTEGER NOT NULL DEFAULT 1,
    timestamp_format TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_mappings (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES schema_profiles(id) ON DELETE CASCADE,
    csv_column_name TEXT NOT NULL,
    logical_field TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    transform_rule TEXT,
    priority INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (profile_id, csv_column_name, logical_field)
);

CREATE INDEX IF NOT EXISTS idx_schema_mappings_profile_id ON schema_mappings(profile_id);

CREATE TABLE IF NOT EXISTS status_classification_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name TEXT NOT NULL,
    match_submit_status TEXT,
    match_dlr_state TEXT,
    normalized_status TEXT NOT NULL CHECK (
        normalized_status IN ('SUCCESS', 'FAILED', 'REJECTED', 'PENDING', 'OTHER', 'UNKNOWN')
    ),
    is_terminal INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_system TEXT NOT NULL DEFAULT 'MediaCore',
    schema_profile_id TEXT REFERENCES schema_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'UPLOADING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'ARCHIVED', 'DELETING')
    ),
    coverage_start TEXT,
    coverage_end TEXT,
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid_rows INTEGER NOT NULL DEFAULT 0,
    invalid_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,
    available_dimensions TEXT NOT NULL DEFAULT '[]',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_datasets_status ON datasets(status);

CREATE TABLE IF NOT EXISTS upload_jobs (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    file_sha256 TEXT,
    storage_provider TEXT NOT NULL DEFAULT 'local',
    storage_bucket TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    is_compressed INTEGER NOT NULL DEFAULT 0,
    schema_profile_id TEXT REFERENCES schema_profiles(id) ON DELETE SET NULL,
    custom_mapping_override TEXT,
    stage INTEGER NOT NULL DEFAULT 1,
    stage_label TEXT NOT NULL DEFAULT 'Upload initiated',
    progress_pct REAL NOT NULL DEFAULT 0.00,
    queue_status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (
        queue_status IN ('AWAITING_UPLOAD', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_retry_at TEXT,
    locked_by TEXT,
    locked_at TEXT,
    checkpoint_row_offset INTEGER NOT NULL DEFAULT 0,
    checkpoint_batch_index INTEGER NOT NULL DEFAULT 0,
    rows_processed INTEGER NOT NULL DEFAULT 0,
    rows_inserted INTEGER NOT NULL DEFAULT 0,
    rows_rejected INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_dataset_id ON upload_jobs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_queue_poll ON upload_jobs(queue_status, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS processing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_job_id TEXT NOT NULL REFERENCES upload_jobs(id) ON DELETE CASCADE,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
    stage INTEGER NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processing_logs_job_id ON processing_logs(upload_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_quality_reports (
    id TEXT PRIMARY KEY,
    upload_job_id TEXT NOT NULL UNIQUE REFERENCES upload_jobs(id) ON DELETE CASCADE,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    total_rows_detected INTEGER NOT NULL DEFAULT 0,
    valid_rows INTEGER NOT NULL DEFAULT 0,
    invalid_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    repeated_header_rows INTEGER NOT NULL DEFAULT 0,
    missing_critical_fields INTEGER NOT NULL DEFAULT 0,
    unknown_status_rows INTEGER NOT NULL DEFAULT 0,
    malformed_timestamps INTEGER NOT NULL DEFAULT 0,
    unrecognized_columns TEXT NOT NULL DEFAULT '[]',
    mapped_columns TEXT NOT NULL DEFAULT '{}',
    error_breakdown TEXT NOT NULL DEFAULT '{}',
    error_report_storage_key TEXT,
    processing_duration_ms INTEGER,
    final_status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_filters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    filter_payload TEXT NOT NULL,
    share_token TEXT UNIQUE,
    is_shared INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    default_dataset_ids TEXT NOT NULL DEFAULT '[]',
    mask_sensitive_identifiers INTEGER NOT NULL DEFAULT 0,
    default_page_size INTEGER NOT NULL DEFAULT 50,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alert_configurations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dimension_type TEXT NOT NULL,
    dimension_filter TEXT,
    metric_name TEXT NOT NULL DEFAULT 'combined_unsuccessful_rate',
    min_sample_size INTEGER NOT NULL DEFAULT 500,
    warning_threshold_pct REAL NOT NULL DEFAULT 10.00,
    critical_threshold_pct REAL NOT NULL DEFAULT 25.00,
    delta_spike_pct REAL NOT NULL DEFAULT 8.00,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS degradation_alerts (
    id TEXT PRIMARY KEY,
    alert_config_id TEXT REFERENCES alert_configurations(id) ON DELETE SET NULL,
    dataset_id TEXT REFERENCES datasets(id) ON DELETE CASCADE,
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    dimension_type TEXT NOT NULL,
    dimension_value TEXT NOT NULL,
    what_changed TEXT NOT NULL,
    detected_window_start TEXT,
    detected_window_end TEXT,
    baseline_value REAL,
    current_value REAL,
    affected_records INTEGER NOT NULL DEFAULT 0,
    suggested_investigation TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    acknowledged_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investigation_notes (
    id TEXT PRIMARY KEY,
    dataset_id TEXT REFERENCES datasets(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    filter_context TEXT NOT NULL DEFAULT '{}',
    dimension_tag TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_exports (
    id TEXT PRIMARY KEY,
    requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    report_type TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('CSV', 'XLSX', 'PDF')),
    filter_payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'QUEUED',
    row_count INTEGER DEFAULT 0,
    file_size_bytes INTEGER DEFAULT 0,
    storage_key TEXT,
    expires_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_email TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed Roles
INSERT OR IGNORE INTO roles (name, description, permissions) VALUES
    ('admin', 'Full platform administration, user management, rules, and deletion', '["*"]'),
    ('analyst', 'Upload CSVs, build analytics, save presets, export reports, manage alerts', '["datasets:read","datasets:write","analytics:read","exports:write","notes:write"]'),
    ('operator', 'Investigate QoS metrics, inspect unmasked ANIs, add operational notes', '["datasets:read","analytics:read","notes:write","pii:read"]'),
    ('viewer', 'Read-only access to dashboards with masked sensitive identifiers', '["datasets:read","analytics:read"]');

-- Seed Default MediaCore XDR Profile
INSERT OR IGNORE INTO schema_profiles (id, name, description, delimiter, has_header, skip_repeated_headers, is_default)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'MediaCore XDR Standard Export (Semicolon)',
    'Verified against MediaCore xdr_all_tps.csv 27-column semicolon export',
    ';', 1, 1, 1
);

INSERT OR IGNORE INTO schema_mappings (id, profile_id, csv_column_name, logical_field, is_required, priority) VALUES
    ('m-01', '11111111-1111-4111-8111-111111111111', 'OP Name', 'OP_NAME', 1, 1),
    ('m-02', '11111111-1111-4111-8111-111111111111', 'TP Name', 'TP_NAME', 1, 1),
    ('m-03', '11111111-1111-4111-8111-111111111111', 'Send Time', 'MESSAGE_TIMESTAMP', 1, 1),
    ('m-04', '11111111-1111-4111-8111-111111111111', 'Clear Number', 'DESTINATION', 0, 1),
    ('m-05', '11111111-1111-4111-8111-111111111111', 'Called Number OUT', 'CALLED_NUMBER_OUT', 0, 1),
    ('m-06', '11111111-1111-4111-8111-111111111111', 'Country', 'COUNTRY', 0, 1),
    ('m-07', '11111111-1111-4111-8111-111111111111', 'OP MCC', 'OP_MCC', 0, 1),
    ('m-08', '11111111-1111-4111-8111-111111111111', 'OP MNC', 'OP_MNC', 0, 1),
    ('m-09', '11111111-1111-4111-8111-111111111111', 'TP MCC', 'TP_MCC', 0, 1),
    ('m-10', '11111111-1111-4111-8111-111111111111', 'TP MNC', 'TP_MNC', 0, 1),
    ('m-11', '11111111-1111-4111-8111-111111111111', 'OP ANI', 'OP_ANI', 0, 1),
    ('m-12', '11111111-1111-4111-8111-111111111111', 'TP ANI', 'TP_ANI', 0, 1),
    ('m-13', '11111111-1111-4111-8111-111111111111', 'Status', 'SUBMIT_STATUS', 0, 1),
    ('m-14', '11111111-1111-4111-8111-111111111111', 'DLR', 'DLR_FLAG', 0, 1),
    ('m-15', '11111111-1111-4111-8111-111111111111', 'DLR time', 'DLR_TIMESTAMP', 0, 1),
    ('m-16', '11111111-1111-4111-8111-111111111111', 'State', 'DLR_STATE', 0, 1),
    ('m-17', '11111111-1111-4111-8111-111111111111', 'OP Price', 'OP_PRICE', 0, 1),
    ('m-18', '11111111-1111-4111-8111-111111111111', 'TP Price', 'TP_PRICE', 0, 1),
    ('m-19', '11111111-1111-4111-8111-111111111111', 'Cost IN', 'COST_IN', 0, 1),
    ('m-20', '11111111-1111-4111-8111-111111111111', 'Cost OUT', 'COST_OUT', 0, 1),
    ('m-21', '11111111-1111-4111-8111-111111111111', 'OP Host', 'OP_HOST', 0, 1),
    ('m-22', '11111111-1111-4111-8111-111111111111', 'TP Host', 'TP_HOST', 0, 1),
    ('m-23', '11111111-1111-4111-8111-111111111111', 'NAS IP', 'NAS_IP', 0, 1),
    ('m-24', '11111111-1111-4111-8111-111111111111', 'Dialpeer', 'ROUTE', 0, 1),
    ('m-25', '11111111-1111-4111-8111-111111111111', 'Message ID', 'MESSAGE_ID', 0, 1),
    ('m-26', '11111111-1111-4111-8111-111111111111', 'OP Currency', 'OP_CURRENCY', 0, 1),
    ('m-27', '11111111-1111-4111-8111-111111111111', 'TP Currency', 'TP_CURRENCY', 0, 1);

INSERT OR IGNORE INTO status_classification_rules (id, rule_name, match_submit_status, match_dlr_state, normalized_status, is_terminal, description, priority) VALUES
    (1, 'DLR Delivered', '', 'DELIVRD', 'SUCCESS', 1, 'Accepted by TP and delivered to handset', 10),
    (2, 'DLR Undelivered', '', 'UNDELIV', 'FAILED', 1, 'Accepted by TP but failed downstream delivery', 20),
    (3, 'DLR Expired', '', 'EXPIRED', 'FAILED', 1, 'Message validity period expired before delivery', 21),
    (4, 'DLR Rejected', '', 'REJECTD', 'REJECTED', 1, 'Rejected at downstream SMSC/carrier in DLR', 22),
    (5, 'DLR Enroute/Pending', '', 'ENROUTE', 'PENDING', 0, 'Accepted and awaiting final delivery receipt', 30),
    (6, 'DLR Accepted Pending', '', 'ACCEPTD', 'PENDING', 0, 'Accepted by downstream entity, final state pending', 31),
    (7, 'Submitted No DLR State', '', '', 'UNKNOWN', 0, 'Accepted by TP (empty Status) but no DLR State reported', 40),
    (8, 'SMPP Submit Error (Any non-empty Status)', '*', '', 'REJECTED', 1, 'Rejected/failed at submit_sm_resp stage (e.g. 69, 11, 88)', 50);
