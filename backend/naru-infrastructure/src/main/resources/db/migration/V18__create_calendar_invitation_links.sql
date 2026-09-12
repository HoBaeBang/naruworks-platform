CREATE TABLE calendar_invitation_links (
    id BIGSERIAL PRIMARY KEY,
    calendar_id BIGINT NOT NULL,
    created_by_member_id BIGINT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    member_role VARCHAR(30) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_calendar_invitation_links_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_calendar_invitation_links_calendar
        FOREIGN KEY (calendar_id) REFERENCES calendars (id) ON DELETE CASCADE,
    CONSTRAINT fk_calendar_invitation_links_creator
        FOREIGN KEY (created_by_member_id) REFERENCES members (id) ON DELETE RESTRICT
);

CREATE INDEX idx_calendar_invitation_links_calendar_active
    ON calendar_invitation_links (calendar_id, expires_at)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE calendar_invitation_links IS '공유 캘린더 참여 권한을 전달하는 단기 링크';
COMMENT ON COLUMN calendar_invitation_links.id IS '초대 링크 내부 식별자';
COMMENT ON COLUMN calendar_invitation_links.calendar_id IS '참여 대상 공유 캘린더 식별자';
COMMENT ON COLUMN calendar_invitation_links.created_by_member_id IS '링크를 발급한 OWNER 회원 식별자';
COMMENT ON COLUMN calendar_invitation_links.token_hash IS '원문을 저장하지 않은 SHA-256 초대 토큰 해시';
COMMENT ON COLUMN calendar_invitation_links.member_role IS '수락 회원에게 부여할 EDITOR 또는 VIEWER 권한';
COMMENT ON COLUMN calendar_invitation_links.expires_at IS '초대 링크 만료 시각, 발급 후 7일';
COMMENT ON COLUMN calendar_invitation_links.revoked_at IS 'OWNER가 링크를 폐기한 시각';
COMMENT ON COLUMN calendar_invitation_links.created_at IS '초대 링크 발급 시각';
