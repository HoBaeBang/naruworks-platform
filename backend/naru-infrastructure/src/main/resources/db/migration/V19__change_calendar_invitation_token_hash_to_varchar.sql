ALTER TABLE calendar_invitation_links
    ALTER COLUMN token_hash TYPE VARCHAR(64);

COMMENT ON COLUMN calendar_invitation_links.token_hash IS '원문을 저장하지 않은 SHA-256 초대 토큰 해시';
