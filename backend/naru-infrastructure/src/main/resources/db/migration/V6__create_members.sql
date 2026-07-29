CREATE TABLE naru_members (
                              id BIGSERIAL PRIMARY KEY,
                              email VARCHAR(255) NOT NULL,
                              display_name VARCHAR(100) NOT NULL,
                              profile_image_url VARCHAR(500),
                              provider VARCHAR(30) NOT NULL,
                              provider_user_id VARCHAR(255) NOT NULL,
                              role VARCHAR(30) NOT NULL,
                              status VARCHAR(30) NOT NULL,
                              referrer_name VARCHAR(100),
                              created_at TIMESTAMP NOT NULL,
                              approved_at TIMESTAMP,
                              last_login_at TIMESTAMP NOT NULL,
                              CONSTRAINT uk_naru_members_provider_user UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_naru_members_email ON naru_members (email);
CREATE INDEX idx_naru_members_status ON naru_members (status);

COMMENT ON TABLE naru_members IS 'NaruWorks 회원';

COMMENT ON COLUMN naru_members.id IS '회원 내부 식별자';
COMMENT ON COLUMN naru_members.email IS 'Google 계정 이메일';
COMMENT ON COLUMN naru_members.display_name IS 'Google 계정 표시 이름';
COMMENT ON COLUMN naru_members.profile_image_url IS 'Google 계정 프로필 이미지 URL';
COMMENT ON COLUMN naru_members.provider IS 'OAuth 인증 제공자';
COMMENT ON COLUMN naru_members.provider_user_id IS 'OAuth 제공자 기준 사용자 식별자';
COMMENT ON COLUMN naru_members.role IS '회원 권한';
COMMENT ON COLUMN naru_members.status IS '회원 승인 상태';
COMMENT ON COLUMN naru_members.referrer_name IS '가입 요청자가 입력한 추천인명';
COMMENT ON COLUMN naru_members.created_at IS '회원 생성 시각';
COMMENT ON COLUMN naru_members.approved_at IS '회원 승인 시각';
COMMENT ON COLUMN naru_members.last_login_at IS '마지막 로그인 시각';
