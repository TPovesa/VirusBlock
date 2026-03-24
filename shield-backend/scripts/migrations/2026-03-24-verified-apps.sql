ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_verified_developer TINYINT(1) DEFAULT 0 AFTER developer_mode_activated_at;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS verified_developer_at BIGINT DEFAULT NULL AFTER is_verified_developer;

CREATE TABLE IF NOT EXISTS developer_applications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    applicant_name VARCHAR(100) NOT NULL,
    applicant_email VARCHAR(255) NOT NULL,
    message VARCHAR(700) DEFAULT NULL,
    status ENUM('PENDING_REVIEW','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING_REVIEW',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    mailed_at BIGINT DEFAULT NULL,
    reviewed_at BIGINT DEFAULT NULL,
    review_note VARCHAR(255) DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_developer_applications_user_created (user_id, created_at),
    INDEX idx_developer_applications_status_created (status, created_at)
);

CREATE TABLE IF NOT EXISTS verified_apps (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    repository_url VARCHAR(700) NOT NULL,
    repository_owner VARCHAR(120) NOT NULL,
    repository_name VARCHAR(120) NOT NULL,
    repository_default_branch VARCHAR(120) DEFAULT NULL,
    release_artifact_url VARCHAR(700) NOT NULL,
    official_site_url VARCHAR(700) DEFAULT NULL,
    platform ENUM('android','windows','linux') NOT NULL,
    app_name VARCHAR(120) NOT NULL,
    author_name VARCHAR(120) NOT NULL,
    avatar_url VARCHAR(700) DEFAULT NULL,
    status ENUM('QUEUED','RUNNING','SAFE','FAILED') NOT NULL DEFAULT 'QUEUED',
    sha256 VARCHAR(64) DEFAULT NULL,
    artifact_file_name VARCHAR(255) DEFAULT NULL,
    artifact_size_bytes BIGINT DEFAULT NULL,
    artifact_content_type VARCHAR(160) DEFAULT NULL,
    risk_score INT NOT NULL DEFAULT 0,
    summary_json LONGTEXT DEFAULT NULL,
    findings_json LONGTEXT DEFAULT NULL,
    public_summary VARCHAR(280) DEFAULT NULL,
    error_message VARCHAR(255) DEFAULT NULL,
    queued_at BIGINT DEFAULT NULL,
    started_at BIGINT DEFAULT NULL,
    completed_at BIGINT DEFAULT NULL,
    verified_at BIGINT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_verified_apps_owner_created (owner_user_id, created_at),
    INDEX idx_verified_apps_status_created (status, created_at),
    INDEX idx_verified_apps_platform_verified (platform, verified_at),
    INDEX idx_verified_apps_sha256 (sha256),
    UNIQUE KEY uniq_verified_apps_owner_artifact (owner_user_id, release_artifact_url)
);
