ALTER TABLE members
    ADD COLUMN referrer_member_id BIGINT;

ALTER TABLE members
    ADD COLUMN referral_code VARCHAR(6);

UPDATE members
SET referral_code = UPPER(
        SUBSTRING(
                MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT || id::TEXT)
                FROM 1 FOR 6
        )
                    )
WHERE referral_code IS NULL;

ALTER TABLE members
    ALTER COLUMN referral_code SET NOT NULL;

ALTER TABLE members
    ADD CONSTRAINT fk_members_referrer_member
        FOREIGN KEY (referrer_member_id)
            REFERENCES members (id)
            ON DELETE RESTRICT;

ALTER TABLE members
    ADD CONSTRAINT uk_members_referral_code
        UNIQUE (referral_code);

CREATE INDEX idx_members_referrer_member_id
    ON members (referrer_member_id);

ALTER TABLE members
DROP COLUMN referrer_name;

COMMENT ON COLUMN members.referrer_member_id
    IS '가입자를 초대한 기존 회원의 내부 식별자';

COMMENT ON COLUMN members.referral_code
    IS '회원 초대에 사용하는 영문 대문자와 숫자 6자리 추천 코드';
