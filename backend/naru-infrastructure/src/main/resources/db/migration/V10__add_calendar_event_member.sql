ALTER TABLE calendar_events
    ADD COLUMN member_id BIGINT;

UPDATE calendar_events
SET member_id = (
    SELECT id
    FROM members
    WHERE role = 'ADMIN'
      AND status = 'APPROVED'
    ORDER BY id
    LIMIT 1
    )
WHERE member_id IS NULL;

ALTER TABLE calendar_events
    ALTER COLUMN member_id SET NOT NULL;

ALTER TABLE calendar_events
    ADD CONSTRAINT fk_calendar_events_member
        FOREIGN KEY (member_id)
            REFERENCES members (id)
            ON DELETE RESTRICT;

CREATE INDEX idx_calendar_events_member_start_at
    ON calendar_events (member_id, start_at);

COMMENT ON COLUMN calendar_events.member_id
    IS '일정을 소유한 회원의 내부 식별자';
