ALTER TABLE calendar_events
    ADD COLUMN recurrence_lunar_month INTEGER,
    ADD COLUMN recurrence_lunar_day INTEGER;

COMMENT ON COLUMN calendar_events.recurrence_lunar_month
    IS '음력 연간 반복 시 기준이 되는 평달 월';
COMMENT ON COLUMN calendar_events.recurrence_lunar_day
    IS '음력 연간 반복 시 기준이 되는 음력 일';

CREATE TABLE calendar_holiday_overrides (
    id BIGSERIAL PRIMARY KEY,
    holiday_date DATE NOT NULL,
    operation VARCHAR(10) NOT NULL,
    holiday_name VARCHAR(100),
    reason VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_calendar_holiday_overrides_date UNIQUE (holiday_date),
    CONSTRAINT ck_calendar_holiday_overrides_operation
        CHECK (operation IN ('ADD', 'REMOVE')),
    CONSTRAINT ck_calendar_holiday_overrides_name
        CHECK (
            (operation = 'ADD' AND holiday_name IS NOT NULL)
            OR operation = 'REMOVE'
        )
);

COMMENT ON TABLE calendar_holiday_overrides
    IS '법정공휴일 계산 결과에 운영상 추가 또는 제외할 날짜 예외';
COMMENT ON COLUMN calendar_holiday_overrides.id
    IS '공휴일 예외의 내부 식별자';
COMMENT ON COLUMN calendar_holiday_overrides.holiday_date
    IS '예외를 적용할 양력 날짜';
COMMENT ON COLUMN calendar_holiday_overrides.operation
    IS 'ADD는 공휴일 추가, REMOVE는 기본 공휴일 제외';
COMMENT ON COLUMN calendar_holiday_overrides.holiday_name
    IS 'ADD 예외일 때 화면에 표시할 공휴일명';
COMMENT ON COLUMN calendar_holiday_overrides.reason
    IS '예외 등록 근거 또는 운영 메모';
COMMENT ON COLUMN calendar_holiday_overrides.created_at
    IS '예외 row가 최초 생성된 시각';
COMMENT ON COLUMN calendar_holiday_overrides.updated_at
    IS '예외 row가 마지막 수정된 시각';
