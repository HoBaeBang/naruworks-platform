CREATE TABLE calendar_events (
                                 id BIGSERIAL PRIMARY KEY,
                                 title VARCHAR(100) NOT NULL,
                                 description TEXT,
                                 start_at TIMESTAMP NOT NULL,
                                 end_at TIMESTAMP NOT NULL,
                                 all_day BOOLEAN NOT NULL,
                                 location VARCHAR(255),
                                 color VARCHAR(20) NOT NULL,
                                 recurrence_rule VARCHAR(30) NOT NULL,
                                 recurrence_end_at TIMESTAMP,
                                 status VARCHAR(30) NOT NULL,
                                 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE calendar_events IS 'Naru Calendar 일정';

COMMENT ON COLUMN calendar_events.id IS '일정 테이블의 내부 식별자';
COMMENT ON COLUMN calendar_events.title IS '일정 제목';
COMMENT ON COLUMN calendar_events.description IS '일정 설명';
COMMENT ON COLUMN calendar_events.start_at IS '일정 시작 일시';
COMMENT ON COLUMN calendar_events.end_at IS '일정 종료 일시';
COMMENT ON COLUMN calendar_events.all_day IS '하루 종일 일정 여부';
COMMENT ON COLUMN calendar_events.location IS '일정 장소';
COMMENT ON COLUMN calendar_events.color IS '화면에 표시할 일정 색상';
COMMENT ON COLUMN calendar_events.recurrence_rule IS '반복 일정 규칙';
COMMENT ON COLUMN calendar_events.recurrence_end_at IS '반복 일정 종료 일시';
COMMENT ON COLUMN calendar_events.status IS '일정 상태';
COMMENT ON COLUMN calendar_events.created_at IS '일정 row가 최초 생성된 시각';
COMMENT ON COLUMN calendar_events.updated_at IS '일정 row가 마지막으로 수정된 시각';
