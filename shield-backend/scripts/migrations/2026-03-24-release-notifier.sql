CREATE TABLE IF NOT EXISTS release_notifier_meta (
    meta_key VARCHAR(120) PRIMARY KEY,
    meta_value LONGTEXT DEFAULT NULL,
    updated_at BIGINT NOT NULL
);
