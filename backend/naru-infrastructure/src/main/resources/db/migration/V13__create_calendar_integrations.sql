CREATE TABLE calendar_integrations (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL,
    provider VARCHAR(30) NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(320) NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    selected_calendar_id VARCHAR(500),
    status VARCHAR(30) NOT NULL,
    last_synced_at TIMESTAMP,
    sync_token TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT fk_calendar_integrations_member
        FOREIGN KEY (member_id) REFERENCES members (id),
    CONSTRAINT uk_calendar_integrations_member_provider UNIQUE (member_id, provider),
    CONSTRAINT ck_calendar_integrations_provider
        CHECK (provider IN ('GOOGLE')),
    CONSTRAINT ck_calendar_integrations_status
        CHECK (status IN ('CONNECTED', 'REVOKED', 'FAILED'))
);

COMMENT ON TABLE calendar_integrations IS '회원별 외부 캘린더 OAuth 연결 정보';
COMMENT ON COLUMN calendar_integrations.member_id IS '연결을 소유한 회원 내부 식별자';
COMMENT ON COLUMN calendar_integrations.provider IS '외부 캘린더 제공자';
COMMENT ON COLUMN calendar_integrations.provider_account_id IS '제공자 기준 연결 계정 식별자';
COMMENT ON COLUMN calendar_integrations.provider_email IS '제공자 계정 이메일';
COMMENT ON COLUMN calendar_integrations.encrypted_refresh_token IS 'AES-GCM으로 암호화한 제공자 refresh token';
COMMENT ON COLUMN calendar_integrations.selected_calendar_id IS '사용자가 선택한 제공자 캘린더 식별자';
COMMENT ON COLUMN calendar_integrations.status IS '외부 캘린더 연결 상태';
COMMENT ON COLUMN calendar_integrations.last_synced_at IS '마지막 외부 일정 동기화 시각';
COMMENT ON COLUMN calendar_integrations.sync_token IS '제공자 증분 동기화용 token';
