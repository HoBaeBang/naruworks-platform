ALTER TABLE naru_members RENAME TO members;

ALTER TABLE members
    RENAME CONSTRAINT uk_naru_members_provider_user TO uk_members_provider_user;

ALTER INDEX idx_naru_members_email RENAME TO idx_members_email;

ALTER INDEX idx_naru_members_status RENAME TO idx_members_status;

COMMENT ON TABLE members IS 'NaruWorks 회원';
