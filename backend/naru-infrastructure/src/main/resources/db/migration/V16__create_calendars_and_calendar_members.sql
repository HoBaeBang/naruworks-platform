CREATE TABLE calendars (
    id BIGSERIAL PRIMARY KEY,
    owner_member_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    calendar_type VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_calendars_owner_member
        FOREIGN KEY (owner_member_id) REFERENCES members (id) ON DELETE RESTRICT
);

CREATE INDEX idx_calendars_owner_member ON calendars (owner_member_id);

COMMENT ON TABLE calendars IS '회원의 개인 또는 공유 일정 공간';
COMMENT ON COLUMN calendars.id IS '캘린더 내부 식별자';
COMMENT ON COLUMN calendars.owner_member_id IS '캘린더를 생성하고 관리하는 회원 식별자';
COMMENT ON COLUMN calendars.name IS '사용자에게 표시할 캘린더 이름';
COMMENT ON COLUMN calendars.calendar_type IS '개인 캘린더 또는 공유 캘린더 구분';
COMMENT ON COLUMN calendars.created_at IS '캘린더 생성 시각';
COMMENT ON COLUMN calendars.updated_at IS '캘린더 마지막 수정 시각';

CREATE TABLE calendar_members (
    id BIGSERIAL PRIMARY KEY,
    calendar_id BIGINT NOT NULL,
    member_id BIGINT NOT NULL,
    member_role VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_calendar_members_calendar_member UNIQUE (calendar_id, member_id),
    CONSTRAINT fk_calendar_members_calendar
        FOREIGN KEY (calendar_id) REFERENCES calendars (id) ON DELETE CASCADE,
    CONSTRAINT fk_calendar_members_member
        FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT
);

CREATE INDEX idx_calendar_members_member ON calendar_members (member_id);

COMMENT ON TABLE calendar_members IS '공유 캘린더 참여 회원과 권한';
COMMENT ON COLUMN calendar_members.id IS '캘린더 참여 관계 내부 식별자';
COMMENT ON COLUMN calendar_members.calendar_id IS '참여 대상 캘린더 식별자';
COMMENT ON COLUMN calendar_members.member_id IS '캘린더에 참여한 회원 식별자';
COMMENT ON COLUMN calendar_members.member_role IS 'OWNER, EDITOR, VIEWER 중 캘린더 권한';
COMMENT ON COLUMN calendar_members.created_at IS '캘린더 참여 시각';

INSERT INTO calendars (owner_member_id, name, calendar_type)
SELECT id, '내 캘린더', 'PERSONAL'
FROM members;

INSERT INTO calendar_members (calendar_id, member_id, member_role)
SELECT calendar.id, calendar.owner_member_id, 'OWNER'
FROM calendars calendar
WHERE calendar.calendar_type = 'PERSONAL';

ALTER TABLE calendar_events RENAME COLUMN member_id TO created_by_member_id;
ALTER TABLE calendar_events ADD COLUMN calendar_id BIGINT;

UPDATE calendar_events event
SET calendar_id = calendar.id
FROM calendars calendar
WHERE calendar.calendar_type = 'PERSONAL'
  AND calendar.owner_member_id = event.created_by_member_id;

ALTER TABLE calendar_events ALTER COLUMN calendar_id SET NOT NULL;
ALTER TABLE calendar_events
    ADD CONSTRAINT fk_calendar_events_calendar
        FOREIGN KEY (calendar_id) REFERENCES calendars (id) ON DELETE RESTRICT;

ALTER INDEX idx_calendar_events_member_start_at RENAME TO idx_calendar_events_creator_start_at;
CREATE INDEX idx_calendar_events_calendar_start_at ON calendar_events (calendar_id, start_at);

COMMENT ON COLUMN calendar_events.created_by_member_id IS '일정을 최초 생성한 회원의 내부 식별자';
COMMENT ON COLUMN calendar_events.calendar_id IS '일정이 속한 개인 또는 공유 캘린더 식별자';
