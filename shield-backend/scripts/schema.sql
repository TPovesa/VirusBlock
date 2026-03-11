CREATE DATABASE IF NOT EXISTS shield_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shield_auth;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    is_premium TINYINT(1) DEFAULT 0,
    premium_expires_at BIGINT DEFAULT NULL,
    last_login_at BIGINT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    device_id VARCHAR(120) NOT NULL,
    refresh_token_hash VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    refresh_expires_at BIGINT NOT NULL,
    revoked_at BIGINT DEFAULT NULL,
    revoke_reason VARCHAR(64) DEFAULT NULL,
    user_agent VARCHAR(255) DEFAULT NULL,
    ip_address VARCHAR(64) DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_auth_sessions_user_id (user_id),
    INDEX idx_auth_sessions_refresh_expires_at (refresh_expires_at),
    INDEX idx_auth_sessions_revoked_at (revoked_at)
);

CREATE TABLE IF NOT EXISTS login_attempts (
    email VARCHAR(255) NOT NULL,
    ip_address VARCHAR(64) NOT NULL,
    failed_count INT NOT NULL DEFAULT 0,
    first_failed_at BIGINT NOT NULL,
    last_failed_at BIGINT NOT NULL,
    locked_until BIGINT DEFAULT NULL,
    PRIMARY KEY (email, ip_address),
    INDEX idx_login_attempts_locked_until (locked_until)
);

CREATE TABLE IF NOT EXISTS scan_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    scan_type ENUM('QUICK','FULL','SELECTIVE') NOT NULL,
    started_at BIGINT NOT NULL,
    completed_at BIGINT NOT NULL,
    total_scanned INT DEFAULT 0,
    threats_found INT DEFAULT 0,
    threats_json LONGTEXT,
    status VARCHAR(20) DEFAULT 'COMPLETED',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_scan_sessions_user_started (user_id, started_at)
);

CREATE TABLE IF NOT EXISTS purchases (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(100) NOT NULL,
    purchase_token VARCHAR(500),
    amount DECIMAL(10,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    purchased_at BIGINT NOT NULL,
    expires_at BIGINT DEFAULT NULL,
    status ENUM('ACTIVE','EXPIRED','CANCELLED') DEFAULT 'ACTIVE',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_purchases_user_status (user_id, status)
);

CREATE TABLE IF NOT EXISTS threat_reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    package_name VARCHAR(255) NOT NULL,
    app_name VARCHAR(255),
    sha256 VARCHAR(64),
    threat_name VARCHAR(255),
    severity VARCHAR(20),
    detection_engine VARCHAR(100),
    reported_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_threat_reports_user_reported (user_id, reported_at)
);
