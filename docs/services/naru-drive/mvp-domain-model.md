# Naru Drive MVP 도메인 모델

## 결정 요약

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 트리 모델 | `drive_entries` 하나로 파일·폴더의 공통 트리를 표현 | 폴더 목록 조회와 이후 공유 권한 연결을 단순화 |
| 파일 전용 정보 | `drive_files`로 분리 | 폴더에 불필요한 저장 객체·크기·MIME 컬럼을 두지 않음 |
| 루트 | `parent_id = NULL`인 논리적 개인 루트 | 사용자마다 보이지 않는 루트 행을 만들지 않음 |
| 소유권 | 모든 entry는 한 명의 `owner_member_id`를 가짐 | MVP는 개인 Drive만 제공 |
| 이름 중복 | 같은 소유자·같은 부모의 활성 entry는 동명 불가 | 파일과 폴더를 찾고 업로드 결과를 예측하기 쉬움 |
| 삭제 | 휴지통으로 소프트 삭제 후 30일 보관 | 오삭제 복구 가능 |
| 공유 | MVP에서는 제외 | 권한 테이블과 공유 링크는 다음 단계에서 추가 |

## ERD

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#f8fafc', 'primaryTextColor': '#0f172a', 'primaryBorderColor': '#64748b', 'lineColor': '#64748b', 'tertiaryColor': '#f8fafc'}}}%%
erDiagram
    MEMBERS ||--o{ DRIVE_ENTRIES : owns
    DRIVE_ENTRIES ||--o| DRIVE_FILES : describes_file
    DRIVE_ENTRIES ||--o{ DRIVE_ENTRIES : contains

    MEMBERS {
        bigint id PK
    }

    DRIVE_ENTRIES {
        bigint id PK
        bigint owner_member_id FK
        bigint parent_id FK "nullable: personal root"
        varchar entry_type "FOLDER | FILE"
        varchar name
        timestamptz deleted_at "nullable: trash state"
        timestamptz created_at
        timestamptz updated_at
    }

    DRIVE_FILES {
        bigint drive_entry_id PK, FK
        varchar storage_key UK
        bigint size_bytes
        varchar content_type "nullable"
        varchar sha256 "nullable"
        varchar upload_status "PENDING | AVAILABLE | FAILED"
    }

    style MEMBERS fill:#f8fafc,stroke:#64748b,color:#0f172a
    style DRIVE_ENTRIES fill:#f8fafc,stroke:#64748b,color:#0f172a
    style DRIVE_FILES fill:#f8fafc,stroke:#64748b,color:#0f172a
```

`DRIVE_ENTRIES.parent_id`는 같은 테이블의 `id`를 참조한다. `parent_id = NULL`은 특정 회원의 논리적 루트이며, 실제 “내 Drive” 폴더 행은 만들지 않는다.

## 테이블 명세

### `drive_entries`

파일·폴더 화면에 보이는 공통 항목과 트리 구조를 책임진다.

| 컬럼 | 물리 타입 | Null | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 불가 | 자동 생성 | 내부 식별자 |
| `owner_member_id` | `BIGINT` | 불가 | 없음 | `members.id`를 참조하는 개인 Drive 소유자 |
| `parent_id` | `BIGINT` | 가능 | `NULL` | 상위 폴더. `NULL`이면 소유자의 루트 |
| `entry_type` | `VARCHAR(20)` | 불가 | 없음 | `FOLDER` 또는 `FILE` |
| `name` | `VARCHAR(255)` | 불가 | 없음 | 화면에 표시하는 파일·폴더 이름 |
| `deleted_at` | `TIMESTAMPTZ` | 가능 | `NULL` | 휴지통 이동 시각. `NULL`이면 활성 상태 |
| `created_at` | `TIMESTAMPTZ` | 불가 | `CURRENT_TIMESTAMP` | 생성 시각 |
| `updated_at` | `TIMESTAMPTZ` | 불가 | `CURRENT_TIMESTAMP` | 이름·부모 변경 시각 |

제약과 index:

```text
PK: drive_entries.id
FK: owner_member_id -> members.id ON DELETE RESTRICT
FK: parent_id -> drive_entries.id ON DELETE RESTRICT
CHECK: entry_type IN ('FOLDER', 'FILE')
UNIQUE: (owner_member_id, COALESCE(parent_id, 0), name) WHERE deleted_at IS NULL
```

`COALESCE(parent_id, 0)`를 사용하면 `NULL` 루트에서도 같은 이름을 하나만 허용할 수 있다. partial unique index는 목록·이름 충돌 검사에도 사용된다.

### `drive_files`

`entry_type = FILE`인 entry에만 하나씩 존재하며, 실제 객체 저장소와의 연결 정보를 책임진다.

| 컬럼 | 물리 타입 | Null | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `drive_entry_id` | `BIGINT` | 불가 | 없음 | `drive_entries.id`를 참조하는 파일 entry. PK이기도 함 |
| `storage_key` | `VARCHAR(512)` | 불가 | 없음 | RustFS 객체 키. 사용자가 입력한 파일명은 포함하지 않음 |
| `size_bytes` | `BIGINT` | 불가 | `0` | 업로드 예정 또는 확정된 바이트 수 |
| `content_type` | `VARCHAR(255)` | 가능 | `NULL` | 브라우저가 보낸 MIME 타입. 신뢰 경계는 별도 검증 |
| `sha256` | `VARCHAR(64)` | 가능 | `NULL` | 향후 무결성 검증용 SHA-256 |
| `upload_status` | `VARCHAR(20)` | 불가 | `PENDING` | `PENDING`, `AVAILABLE`, `FAILED` |

제약과 index:

```text
PK/FK: drive_entry_id -> drive_entries.id ON DELETE RESTRICT
UNIQUE: storage_key
CHECK: size_bytes >= 0
CHECK: upload_status IN ('PENDING', 'AVAILABLE', 'FAILED')
INDEX: (upload_status)
```

## 권한 규칙

MVP에서는 공유를 만들지 않는다. 인증된 회원 `currentMemberId`가 `owner_member_id`와 같을 때만 읽기·생성·수정·다운로드·휴지통 이동을 허용한다.

```text
대상 entry가 없음 또는 소유자가 다름 = 404 Not Found
상위 폴더가 없거나 FOLDER가 아님 = 400 Bad Request
상위 폴더의 소유자가 다름 = 404 Not Found
```

다른 회원의 entry 존재 여부를 드러내지 않기 위해 소유권 불일치는 `403` 대신 `404`로 응답한다.

## 휴지통 정책

- 파일 또는 폴더 삭제는 즉시 RustFS 객체를 삭제하지 않고 `deleted_at`을 기록한다.
- 폴더를 휴지통으로 옮기면 하위 entry도 함께 휴지통으로 옮긴다.
- 휴지통 목록에서는 같은 소유자의 삭제 항목만 조회한다.
- 30일 뒤 영구 삭제 대상이 된다. 실제 정리 job은 휴지통 API 다음 이슈에서 구현한다.
- 영구 삭제 시 DB 메타데이터와 RustFS 객체를 함께 정리한다. 한쪽 실패 시 재시도 가능한 상태를 남긴다.

## 이후 공유 확장

회원 공유를 시작할 때 `drive_entry_permissions`를 추가한다. `entry_id`, `member_id`, `role(VIEWER|EDITOR)`, `granted_by_member_id`를 두고, 소유자는 암묵적으로 모든 권한을 유지한다. 현재 테이블에는 공유 관련 nullable 컬럼을 미리 넣지 않는다.
