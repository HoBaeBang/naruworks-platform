CREATE TABLE calendar_integration_calendars (
    id BIGSERIAL PRIMARY KEY,
    calendar_integration_id BIGINT NOT NULL,
    provider_calendar_id VARCHAR(500) NOT NULL,
    calendar_name VARCHAR(255) NOT NULL,
    calendar_color VARCHAR(20),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at TIMESTAMP,
    sync_token TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_calendar_integration_calendars_integration
        FOREIGN KEY (calendar_integration_id) REFERENCES calendar_integrations (id) ON DELETE CASCADE,
    CONSTRAINT uk_calendar_integration_calendars_integration_calendar
        UNIQUE (calendar_integration_id, provider_calendar_id)
);

CREATE INDEX idx_calendar_integration_calendars_integration_id
    ON calendar_integration_calendars (calendar_integration_id);

COMMENT ON TABLE calendar_integration_calendars IS '외부 계정 연결별 Google 캘린더 선택 및 동기화 설정';
COMMENT ON COLUMN calendar_integration_calendars.calendar_integration_id IS '외부 계정 연결 내부 식별자';
COMMENT ON COLUMN calendar_integration_calendars.provider_calendar_id IS 'Google Calendar API 기준 캘린더 식별자';
COMMENT ON COLUMN calendar_integration_calendars.calendar_name IS 'Google이 반환한 캘린더 표시 이름';
COMMENT ON COLUMN calendar_integration_calendars.calendar_color IS 'Google이 반환한 캘린더 색상';
COMMENT ON COLUMN calendar_integration_calendars.enabled IS 'NaruWorks 화면에 표시할지 여부';
COMMENT ON COLUMN calendar_integration_calendars.last_synced_at IS '이 캘린더의 마지막 외부 일정 동기화 시각';
COMMENT ON COLUMN calendar_integration_calendars.sync_token IS '이 캘린더의 Google 증분 동기화용 token';

ALTER TABLE calendar_integrations DROP COLUMN selected_calendar_id;
ALTER TABLE calendar_integrations DROP COLUMN last_synced_at;
ALTER TABLE calendar_integrations DROP COLUMN sync_token;
