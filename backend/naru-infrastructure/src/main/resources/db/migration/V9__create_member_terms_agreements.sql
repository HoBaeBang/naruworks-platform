CREATE TABLE member_terms_agreements (
                                         id BIGSERIAL PRIMARY KEY,
                                         member_id BIGINT NOT NULL,
                                         agreement_type VARCHAR(30) NOT NULL,
                                         agreement_version VARCHAR(30) NOT NULL,
                                         agreed_at TIMESTAMP NOT NULL,
                                         CONSTRAINT fk_member_terms_agreements_member
                                             FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT,
                                         CONSTRAINT uk_member_terms_agreements_member_type_version
                                             UNIQUE (member_id, agreement_type, agreement_version)
);

CREATE INDEX idx_member_terms_agreements_member_id
    ON member_terms_agreements (member_id);

COMMENT ON TABLE member_terms_agreements
    IS '회원 약관 동의 이력';

COMMENT ON COLUMN member_terms_agreements.id
    IS '약관 동의 이력 내부 식별자';

COMMENT ON COLUMN member_terms_agreements.member_id
    IS '약관에 동의한 회원의 내부 식별자';

COMMENT ON COLUMN member_terms_agreements.agreement_type
    IS '동의한 약관 유형';

COMMENT ON COLUMN member_terms_agreements.agreement_version
    IS '동의한 약관 버전';

COMMENT ON COLUMN member_terms_agreements.agreed_at
    IS '약관 동의 시각';
