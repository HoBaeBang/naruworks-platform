ALTER TABLE calendar_integrations
    DROP CONSTRAINT uk_calendar_integrations_member_provider;

ALTER TABLE calendar_integrations
    ADD CONSTRAINT uk_calendar_integrations_member_provider_account
        UNIQUE (member_id, provider, provider_account_id);

COMMENT ON TABLE calendar_integrations IS '회원별 외부 캘린더 OAuth 계정 연결 정보';
