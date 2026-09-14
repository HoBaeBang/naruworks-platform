ALTER TABLE calendar_integrations
    ALTER COLUMN encrypted_refresh_token DROP NOT NULL,
    ADD COLUMN last_sync_attempted_at TIMESTAMP,
    ADD COLUMN last_synced_at TIMESTAMP,
    ADD COLUMN last_sync_error TEXT;

COMMENT ON COLUMN calendar_integrations.last_sync_attempted_at IS '최근 외부 일정 동기화를 시도한 시각';
COMMENT ON COLUMN calendar_integrations.last_synced_at IS '최근 외부 일정 동기화에 성공한 시각';
COMMENT ON COLUMN calendar_integrations.last_sync_error IS '최근 외부 일정 동기화 실패 원인';
