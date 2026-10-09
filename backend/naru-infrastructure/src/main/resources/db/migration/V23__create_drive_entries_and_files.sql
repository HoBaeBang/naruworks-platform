CREATE TABLE drive_entries
(
    id              BIGSERIAL    NOT NULL PRIMARY KEY,
    owner_member_id BIGINT       NOT NULL,
    parent_id       BIGINT                DEFAULT NULL,
    entry_type      VARCHAR(20)  NOT NULL,
    name            VARCHAR(255) NOT NULL,
    deleted_at      TIMESTAMP,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_drive_entries_owner_member
        FOREIGN KEY (owner_member_id) REFERENCES members (id) ON DELETE RESTRICT,
    CONSTRAINT fk_drive_entries_parent
        FOREIGN KEY (parent_id) REFERENCES drive_entries (id) ON DELETE RESTRICT,
    CONSTRAINT ck_drive_entries_entry_type
        CHECK (entry_type IN ('FOLDER', 'FILE')),
    CONSTRAINT ck_drive_entries_not_self_parent
        CHECK (parent_id IS NULL OR parent_id <> id)
);

-- 활성 상태의 같은 소유자·같은 폴더에서 동명 항목을 막음
CREATE UNIQUE INDEX uk_drive_entries_active_sibling_name
    ON drive_entries (owner_member_id, COALESCE(parent_id, 0), name) WHERE deleted_at IS NULL;

-- 현재 폴더의 활성 자식 목록을 빠르게 조회
CREATE INDEX idx_drive_entries_active_children
    ON drive_entries (owner_member_id, parent_id, name) WHERE deleted_at IS NULL;

COMMENT
ON TABLE drive_entries
    IS '드라이브 구조';

COMMENT
ON COLUMN drive_entries.id
    IS '드라이브 구조 내부 식별자';

COMMENT
ON COLUMN drive_entries.owner_member_id
    IS '드라이브 구조의 소유 회원의 내부식별자';

COMMENT
ON COLUMN drive_entries.parent_id
    IS '상위 폴더 NULL 이면 소유자 루트';

COMMENT
ON COLUMN drive_entries.entry_type
    IS '드라이브 구성 타입 FOLDER 또는 FILE';

COMMENT
ON COLUMN drive_entries.name
    IS '화면에 표시하는 파일 또는 폴더 이름';

COMMENT
ON COLUMN drive_entries.deleted_at
    IS '휴지통 이동 시각';

COMMENT
ON COLUMN drive_entries.created_at
    IS '생성 시각';

COMMENT
ON COLUMN drive_entries.updated_at
    IS '변경 시각';


CREATE TABLE drive_files
(
    drive_entry_id      BIGINT       NOT NULL PRIMARY KEY,
    storage_key         VARCHAR(512) NOT NULL,
    size_bytes          BIGINT       NOT NULL DEFAULT 0,
    content_type        VARCHAR(255)          DEFAULT NULL,
    sha256              VARCHAR(64)           DEFAULT NULL,
    upload_status       VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    upload_started_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_drive_files_entry
        FOREIGN KEY (drive_entry_id) REFERENCES drive_entries (id) ON DELETE RESTRICT,
    CONSTRAINT uk_drive_files_storage_key UNIQUE (storage_key),
    CONSTRAINT ck_drive_files_size_bytes
        CHECK ( size_bytes >= 0 ),
    CONSTRAINT ck_drive_files_upload_status
        CHECK (upload_status IN ('PENDING', 'AVAILABLE', 'FAILED'))
);

COMMENT
ON TABLE drive_files
    IS '파일';

COMMENT
ON COLUMN drive_files.drive_entry_id
    IS '파일 식별자';

COMMENT
ON COLUMN drive_files.storage_key
    IS '파일 객체 키';

COMMENT
ON COLUMN drive_files.size_bytes
    IS '파일 사이즈';

COMMENT
ON COLUMN drive_files.content_type
    IS '컨텐츠 타입';

COMMENT
ON COLUMN drive_files.sha256
    IS '무결성 검증 SHA-256';

COMMENT
ON COLUMN drive_files.upload_status
    IS '파일 업로드 상태';

COMMENT
ON COLUMN drive_files.upload_started_at
    IS '파일 업로드 시각';
