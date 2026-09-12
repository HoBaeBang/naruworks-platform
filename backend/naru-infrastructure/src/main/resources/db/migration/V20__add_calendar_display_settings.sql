ALTER TABLE calendars
    ADD COLUMN display_color VARCHAR(20) NOT NULL DEFAULT '#20b977';

ALTER TABLE calendars
    ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE calendars
SET is_default = TRUE
WHERE calendar_type = 'PERSONAL';

COMMENT ON COLUMN calendars.display_color IS '캘린더 목록과 새 일정 기본값에 사용할 표시 색상';
COMMENT ON COLUMN calendars.is_default IS '회원의 새 일정 생성 기본 대상 여부';
