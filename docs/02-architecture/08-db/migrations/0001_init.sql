-- 08 DB v0.2. PostgreSQL / sqlx migrate 문서용 초안.
-- 컬럼, 제약, 인덱스는 설계 제안이다.

CREATE TABLE members (
    id uuid PRIMARY KEY,
    google_subject text NOT NULL UNIQUE CHECK (google_subject <> ''),
    google_name text NOT NULL,
    google_email text NOT NULL CHECK (google_email <> ''),
    photo_url text,
    suspended boolean NOT NULL,
    withdrawn_at timestamptz
);

CREATE INDEX members_active_email_idx ON members (lower(google_email))
    WHERE withdrawn_at IS NULL AND NOT suspended;
CREATE INDEX members_withdrawn_at_idx ON members (withdrawn_at)
    WHERE withdrawn_at IS NOT NULL;

CREATE TABLE member_settings (
    member_id uuid PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
    display_name text UNIQUE CHECK (display_name <> ''),
    language text CHECK (language IN ('ko', 'en')),
    theme text NOT NULL CHECK (theme IN ('system', 'light', 'dark'))
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    credential_digest bytea NOT NULL UNIQUE CHECK (octet_length(credential_digest) > 0),
    login_started_at timestamptz NOT NULL,
    last_activity_at timestamptz NOT NULL CHECK (last_activity_at >= login_started_at),
    data_restored boolean NOT NULL
);

CREATE INDEX sessions_member_id_idx ON sessions (member_id);

-- B-1 나루 OP. URI 등록과 비밀 저장소 위치 참조만 저장한다.
CREATE TABLE oidc_clients (
    client_id text PRIMARY KEY CHECK (client_id <> ''),
    redirect_uri text NOT NULL CHECK (redirect_uri LIKE 'https://%'),
    post_logout_redirect_uri text NOT NULL CHECK (post_logout_redirect_uri LIKE 'https://%'),
    backchannel_logout_uri text NOT NULL CHECK (backchannel_logout_uri LIKE 'https://%'),
    grant_types text[] NOT NULL CHECK (
        grant_types = ARRAY['authorization_code', 'refresh_token']::text[]
    ),
    token_endpoint_auth_method text NOT NULL CHECK (token_endpoint_auth_method = 'client_secret_basic'),
    client_secret_ref text NOT NULL CHECK (client_secret_ref <> ''),
    UNIQUE (client_id, redirect_uri)
);

CREATE TABLE oidc_authorization_codes (
    code_digest bytea PRIMARY KEY CHECK (octet_length(code_digest) = 32),
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    pkce_challenge text NOT NULL CHECK (pkce_challenge ~ '^[A-Za-z0-9_-]{43}$'),
    pkce_method text NOT NULL CHECK (pkce_method = 'S256'),
    nonce text NOT NULL CHECK (nonce <> ''),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
    consumed_at timestamptz CHECK (consumed_at >= issued_at AND consumed_at < expires_at),
    FOREIGN KEY (client_id, redirect_uri)
        REFERENCES oidc_clients (client_id, redirect_uri) ON DELETE CASCADE
);

CREATE INDEX oidc_authorization_codes_session_idx ON oidc_authorization_codes (session_id);
CREATE INDEX oidc_authorization_codes_expiry_idx ON oidc_authorization_codes (expires_at);

CREATE TABLE oidc_signing_keys (
    kid text PRIMARY KEY CHECK (kid <> ''),
    algorithm text NOT NULL CHECK (algorithm = 'RS256'),
    activated_at timestamptz,
    deactivated_at timestamptz CHECK (
        deactivated_at IS NULL OR (activated_at IS NOT NULL AND deactivated_at > activated_at)
    ),
    key_ref text NOT NULL CHECK (key_ref <> '')
);

CREATE UNIQUE INDEX oidc_signing_keys_one_active_idx ON oidc_signing_keys (algorithm)
    WHERE activated_at IS NOT NULL AND deactivated_at IS NULL;

CREATE TABLE oidc_token_grants (
    refresh_token_digest bytea PRIMARY KEY CHECK (octet_length(refresh_token_digest) = 32),
    access_token_digest bytea NOT NULL UNIQUE CHECK (octet_length(access_token_digest) = 32),
    family_id uuid NOT NULL,
    client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE CASCADE,
    session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    issued_at timestamptz NOT NULL,
    access_expires_at timestamptz NOT NULL CHECK (access_expires_at > issued_at),
    refresh_expires_at timestamptz NOT NULL CHECK (refresh_expires_at >= access_expires_at),
    refresh_used_at timestamptz CHECK (refresh_used_at >= issued_at AND refresh_used_at < refresh_expires_at),
    revoked_at timestamptz CHECK (revoked_at >= issued_at)
);

CREATE INDEX oidc_token_grants_session_idx ON oidc_token_grants (session_id);
CREATE INDEX oidc_token_grants_family_idx ON oidc_token_grants (client_id, session_id, family_id);

CREATE TABLE oidc_logout_deliveries (
    id uuid PRIMARY KEY,
    client_id text NOT NULL REFERENCES oidc_clients (client_id) ON DELETE RESTRICT,
    sid uuid NOT NULL,
    created_at timestamptz NOT NULL,
    next_attempt_at timestamptz NOT NULL CHECK (next_attempt_at >= created_at),
    delivered_at timestamptz CHECK (delivered_at >= created_at),
    UNIQUE (client_id, sid)
);

CREATE INDEX oidc_logout_deliveries_pending_idx ON oidc_logout_deliveries (next_attempt_at)
    WHERE delivered_at IS NULL;

CREATE TABLE categories (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (name <> '')
);

CREATE TABLE services (
    id uuid PRIMARY KEY,
    category_id uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (name <> ''),
    kind text NOT NULL CHECK (kind IN ('drive', 'openSource')),
    visible boolean NOT NULL,
    CHECK (kind <> 'drive' OR visible)
);

CREATE INDEX services_category_id_idx ON services (category_id);

CREATE TABLE drive_items (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
    parent_id uuid,
    name text NOT NULL CHECK (name <> ''),
    kind text NOT NULL CHECK (kind IN ('folder', 'file')),
    modified_at timestamptz NOT NULL,
    trashed_at timestamptz,
    trash_original_parent_names text[],
    UNIQUE (owner_id, id),
    UNIQUE (id, kind),
    FOREIGN KEY (owner_id, parent_id) REFERENCES drive_items (owner_id, id),
    CHECK (parent_id IS DISTINCT FROM id),
    CHECK ((trashed_at IS NULL) = (trash_original_parent_names IS NULL))
);

CREATE INDEX drive_items_owner_parent_idx ON drive_items (owner_id, parent_id);
CREATE UNIQUE INDEX drive_items_live_root_name_uq ON drive_items (owner_id, name)
    WHERE parent_id IS NULL AND trashed_at IS NULL;
CREATE UNIQUE INDEX drive_items_live_sibling_name_uq ON drive_items (owner_id, parent_id, name)
    WHERE parent_id IS NOT NULL AND trashed_at IS NULL;
CREATE INDEX drive_items_trashed_at_idx ON drive_items (trashed_at)
    WHERE trashed_at IS NOT NULL;

CREATE TABLE drive_files (
    item_id uuid PRIMARY KEY,
    item_kind text NOT NULL CHECK (item_kind = 'file'),
    current_revision_id uuid NOT NULL,
    is_litpage_document boolean NOT NULL,
    FOREIGN KEY (item_id, item_kind) REFERENCES drive_items (id, kind) ON DELETE CASCADE
);

CREATE TABLE file_revisions (
    id uuid PRIMARY KEY,
    file_id uuid NOT NULL REFERENCES drive_files (item_id) ON DELETE CASCADE,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    file_type text,
    object_key text NOT NULL UNIQUE CHECK (object_key <> ''),
    storage_state text NOT NULL CHECK (storage_state IN ('ready', 'deleting')),
    thumbnail_object_key text UNIQUE CHECK (thumbnail_object_key <> ''),
    created_at timestamptz NOT NULL,
    UNIQUE (file_id, id)
);

CREATE INDEX file_revisions_file_created_idx ON file_revisions (file_id, created_at DESC, id);

ALTER TABLE drive_files
    ADD CONSTRAINT drive_files_current_revision_fk
    FOREIGN KEY (item_id, current_revision_id) REFERENCES file_revisions (file_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE litpage_storage_folders (
    member_id uuid PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
    folder_id uuid NOT NULL,
    FOREIGN KEY (member_id, folder_id) REFERENCES drive_items (owner_id, id) ON DELETE CASCADE
);

CREATE TABLE member_file_shares (
    file_id uuid NOT NULL REFERENCES drive_files (item_id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    permission text NOT NULL CHECK (permission IN ('view', 'edit')),
    download_allowed boolean,
    PRIMARY KEY (file_id, recipient_id),
    CHECK ((permission = 'view') = (download_allowed IS NOT NULL))
);

CREATE INDEX member_file_shares_recipient_file_idx ON member_file_shares (recipient_id, file_id);

CREATE TABLE public_file_links (
    file_id uuid PRIMARY KEY REFERENCES drive_files (item_id) ON DELETE CASCADE,
    key_digest bytea NOT NULL UNIQUE CHECK (octet_length(key_digest) > 0),
    key_ciphertext bytea NOT NULL CHECK (octet_length(key_ciphertext) > 0),
    download_allowed boolean NOT NULL
);

CREATE TABLE deletion_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('account_withdrawn', 'account_restored', 'account_purged', 'trash_purged')),
    occurred_at timestamptz NOT NULL
);

CREATE INDEX deletion_events_target_id_idx ON deletion_events (target_id, id);
CREATE UNIQUE INDEX deletion_events_terminal_target_uq ON deletion_events (target_id, kind)
    WHERE kind IN ('account_purged', 'trash_purged');
