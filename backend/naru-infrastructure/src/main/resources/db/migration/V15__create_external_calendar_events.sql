CREATE TABLE external_calendar_events (
    id BIGSERIAL PRIMARY KEY,
    calendar_integration_calendar_id BIGINT NOT NULL,
    provider_event_id VARCHAR(1024) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_at TIMESTAMP NOT NULL,
    end_at TIMESTAMP NOT NULL,
    all_day BOOLEAN NOT NULL,
    location VARCHAR(500),
    color VARCHAR(20),
    provider_updated_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_external_calendar_events_calendar
        FOREIGN KEY (calendar_integration_calendar_id)
        REFERENCES calendar_integration_calendars (id) ON DELETE CASCADE,
    CONSTRAINT uk_external_calendar_events_calendar_event
        UNIQUE (calendar_integration_calendar_id, provider_event_id)
);

CREATE INDEX idx_external_calendar_events_calendar_start_at
    ON external_calendar_events (calendar_integration_calendar_id, start_at);

COMMENT ON TABLE external_calendar_events IS 'Google Calendar에서 읽어 온 외부 일정 저장본';
COMMENT ON COLUMN external_calendar_events.calendar_integration_calendar_id IS '외부 일정을 제공한 선택 Google 캘린더 식별자';
COMMENT ON COLUMN external_calendar_events.provider_event_id IS 'Google Calendar API 기준 이벤트 식별자';
COMMENT ON COLUMN external_calendar_events.title IS 'Google에서 읽어 온 일정 제목';
COMMENT ON COLUMN external_calendar_events.description IS 'Google에서 읽어 온 일정 설명';
COMMENT ON COLUMN external_calendar_events.start_at IS '외부 일정 시작 일시';
COMMENT ON COLUMN external_calendar_events.end_at IS '외부 일정 종료 일시';
COMMENT ON COLUMN external_calendar_events.all_day IS '종일 일정 여부';
COMMENT ON COLUMN external_calendar_events.location IS 'Google에서 읽어 온 일정 장소';
COMMENT ON COLUMN external_calendar_events.color IS 'Google에서 읽어 온 일정 또는 캘린더 색상';
COMMENT ON COLUMN external_calendar_events.provider_updated_at IS 'Google 원본 일정 마지막 수정 시각';
