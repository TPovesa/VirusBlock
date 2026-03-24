ALTER TABLE support_chats
    ADD COLUMN IF NOT EXISTS telegram_control_message_id BIGINT DEFAULT NULL AFTER telegram_topic_name,
    ADD COLUMN IF NOT EXISTS last_client_ip VARCHAR(64) DEFAULT NULL AFTER telegram_control_message_id,
    ADD COLUMN IF NOT EXISTS last_client_user_agent VARCHAR(255) DEFAULT NULL AFTER last_client_ip;

CREATE TABLE IF NOT EXISTS support_chat_bans (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    ip_address VARCHAR(64) DEFAULT NULL,
    support_chat_id VARCHAR(36) DEFAULT NULL,
    blocked_by_telegram_user_id VARCHAR(64) DEFAULT NULL,
    blocked_by_username VARCHAR(120) DEFAULT NULL,
    reason VARCHAR(255) DEFAULT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    revoked_at BIGINT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (support_chat_id) REFERENCES support_chats(id) ON DELETE SET NULL,
    INDEX idx_support_chat_bans_user_active (user_id, revoked_at, created_at),
    INDEX idx_support_chat_bans_ip_active (ip_address, revoked_at, created_at)
);
