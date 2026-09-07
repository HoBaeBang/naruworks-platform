CREATE TABLE calendar_event_exceptions (
    id BIGSERIAL PRIMARY KEY,
    calendar_event_id BIGINT NOT NULL,
    occurrence_start_at TIMESTAMP NOT NULL,
    exception_type VARCHAR(30) NOT NULL,
    title VARCHAR(100),
    description TEXT,
    start_at TIMESTAMP,
    end_at TIMESTAMP,
    all_day BOOLEAN,
    location VARCHAR(255),
    color VARCHAR(20),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_calendar_event_exceptions_event_occurrence
        UNIQUE (calendar_event_id, occurrence_start_at),
    CONSTRAINT fk_calendar_event_exceptions_event
        FOREIGN KEY (calendar_event_id)
            REFERENCES calendar_events (id)
            ON DELETE CASCADE
);

CREATE INDEX idx_calendar_event_exceptions_event
    ON calendar_event_exceptions (calendar_event_id);

COMMENT ON TABLE calendar_event_exceptions IS '반복 일정의 특정 발생 회차 예외';
COMMENT ON COLUMN calendar_event_exceptions.id IS '반복 일정 예외의 내부 식별자';
COMMENT ON COLUMN calendar_event_exceptions.calendar_event_id IS '반복 원본 일정의 내부 식별자';
COMMENT ON COLUMN calendar_event_exceptions.occurrence_start_at IS '원본 규칙으로 계산한 예외 대상 회차의 시작 일시';
COMMENT ON COLUMN calendar_event_exceptions.exception_type IS '특정 회차 취소 또는 상세 값 재정의 여부';
COMMENT ON COLUMN calendar_event_exceptions.title IS '재정의한 일정 제목';
COMMENT ON COLUMN calendar_event_exceptions.description IS '재정의한 일정 설명';
COMMENT ON COLUMN calendar_event_exceptions.start_at IS '재정의한 일정 시작 일시';
COMMENT ON COLUMN calendar_event_exceptions.end_at IS '재정의한 일정 종료 일시';
COMMENT ON COLUMN calendar_event_exceptions.all_day IS '재정의한 하루 종일 일정 여부';
COMMENT ON COLUMN calendar_event_exceptions.location IS '재정의한 일정 장소';
COMMENT ON COLUMN calendar_event_exceptions.color IS '재정의한 일정 표시 색상';
COMMENT ON COLUMN calendar_event_exceptions.created_at IS '예외 row가 최초 생성된 시각';
COMMENT ON COLUMN calendar_event_exceptions.updated_at IS '예외 row가 마지막 수정된 시각';
