<!-- naru-orch job=P2-9-db-08-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=c3f849da-4e16-40f7-8034-5d5aa9991d90 saved=2026-11-26T21:19:54+09:00 -->

## 1. 요약

| 대상 문서 | blocking | major | minor | 합계 |
| --- | ---: | ---: | ---: | ---: |
| [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md) | 0 | 0 | 0 | 0 |
| [0001_init.sql](../../../docs/02-architecture/08-db/migrations/0001_init.sql) | 0 | 0 | 0 | 0 |
| [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml) (v0.2) | 0 | 0 | 0 | 0 |
| [07-api.md](../../../docs/02-architecture/07-api/07-api.md) (v0.2) | 0 | 0 | 0 | 0 |
| **총계** | **0** | **0** | **0** | **0** |

- **테이블 수·목록 (12개)**: `members`, `member_settings`, `sessions`, `categories`, `services`, `drive_items`, `drive_files`, `file_revisions`, `litpage_storage_folders`, `member_file_shares`, `public_file_links`, `deletion_events`
- **07 v0.2 추가 필드 출처 일치**: `DriveItemPage.breadcrumbs`(DM-003)는 `drive_items`의 `parent_id` 재귀 탐색으로, `PublicLink.name`/`sizeBytes`(DM-005)는 `public_file_links`로 조회한 파일의 `drive_items.name`과 현재 `file_revisions.size_bytes`로 스키마 출처와 일치한다.

---

## 2. 설계 결함 표

남은 blocking/major 없음 (minor 포함 발견된 결함 없음).

---

## 3. 점검 목록

1. **07 API와 스키마 일치**: **충족** — [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml)의 모든 응답 스키마(`Session`, `Profile`, `Category`, `Service`, `LitpageEntry`, `StorageFolder`, `DriveItem`, `DriveItemPage`/`Breadcrumb`, `FolderUploadResult`, `TrashItem`, `ShareRecipient`/`MemberShare`/`MemberShareSettings`, `EditResult`, `LinkSettings`, `PublicLink`, `AdminMember`, `AdminOpenSource`, `*Page`, `Binary`, `Text`, `Error`), 응답 헤더(`X-Request-Id`, `X-File-Revision`, `Content-Disposition`, `Location`, `Set-Cookie`, `X-CSRF-Token`, `Cache-Control`) 및 `204` 응답이 [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L230-L263)의 「07 API v0.2 응답과 데이터 출처」표와 모순 없이 대응된다.
2. **문서와 SQL 일치**: **충족** — [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L41-L210)의 12개 테이블·컬럼·타입·제약·인덱스 및 `erDiagram`([L16-L37](../../../docs/02-architecture/08-db/08-db-schema.md#L16-L37))이 [0001_init.sql](../../../docs/02-architecture/08-db/migrations/0001_init.sql#L4-L137)과 1:1로 일치한다.
3. **기준 FR/BR/NFR/DEC 반영**: **충족** — Must FR 26개 데이터와 DEC-090(단일 업로드·청크 테이블 미생성), DEC-107(0바이트 거부), DEC-096(달력 30일 휴지통·탈퇴 및 휴지통 시계 진행), DEC-091(회원·드라이브 파일만 백업 및 `deletion_events` 재적용), DEC-092(유휴 7일·절대 30일), DEC-098(`members.suspended` 기반 재로그인·갱신·Litpage 진입 차단, 열린 세션 즉시 미종료), DEC-101(`system`/`light`/`dark`), DEC-100·110(계정 언어 우선), DEC-114(재가입 시 정지 유지·받은 공유 미복구)가 모두 반영되었다.
4. **보존 규칙**: **충족** — `members.withdrawn_at`, `drive_items.trashed_at`, `sessions.login_started_at`/`last_activity_at`, `file_revisions.created_at`/`storage_state`, `deletion_events`로 뒷받침되며, Q-085(시간대·경계 시각·시작일)와 Q-081·Q-091(로그 30일·감사 기록 항목/기간/법적 적정성)을 단정 없이 `[미확인]`으로 분리 유지했다([08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L211-L222)).
5. **금지·미확인 단정 여부**: **충족** — RB-017, GAP-016·018·025, Q-081·085·087·091·092가 모두 `[미확인]`으로 남았고, SSO B-2 토큰 테이블 고정·비밀 값·없는 ID·기획 제외 기능·기존 DB 데이터 이전 전제가 없다([08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L266-L286)).
6. **ADR 0003 충돌 여부**: **충족** — [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md)의 PostgreSQL 및 `sqlx migrate` 기준을 따르며, [0001_init.sql](../../../docs/02-architecture/08-db/migrations/0001_init.sql)은 문서용 초안으로 두고 `_sqlx_migrations`를 포함하거나 실행을 전제하지 않았다.

---

## 4. 07 v0.2 필드 출처 확인 결과

- **DM-003 (`DriveItemPage.breadcrumbs`)**:
  - **07 정의**: [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml#L3263-L3289) 및 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L214)에서 `Breadcrumb` 배열(`id`, `name`)로 정의. 루트 첫 폴더부터 현재 조회 폴더까지 순서대로 포함하며 루트 목록 및 받은 공유 목록은 빈 배열.
  - **08 출처**: [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L246)에서 현재 조회 폴더로부터 동일 `owner_id`의 `drive_items.parent_id`를 루트까지 재귀 탐색해 역순으로 `drive_items.id`, `name`을 투영(루트·받은 공유 목록은 빈 배열)하는 것으로 명확히 도출된다.
- **DM-005 (`PublicLink.name`, `PublicLink.sizeBytes`)**:
  - **07 정의**: [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml#L3168-L3179) 및 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L215)에서 필수 `name`, `sizeBytes`, `downloadAllowed`로 정의.
  - **08 출처**: [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L253)에서 `public_file_links.key_digest`로 찾은 파일의 `drive_items.name`, 현재 `file_revisions.size_bytes`(통해 `drive_files.current_revision_id` 참조), `public_file_links.download_allowed`(탈퇴 보관 중 다운로드 금지 적용)로 명확히 출처가 설명된다.

---

## 5. 남은 [미확인] 목록

[08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L270-L286) 및 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L227-L242)에 유지된 항목:
- **기획·운영 미확인**: `RB-017`, `GAP-016`, `GAP-018`, `GAP-025`, `Q-081`, `Q-085`, `Q-087`, `Q-091`, `Q-092`
- **디자인 대응 미확인**: `DM-002`, `DM-004`, `DM-006`, `DM-007`, `DM-009`, `DM-010`, `DM-011`
- **09·후속 ADR 이관**: B-2 최종 선택 및 내부 자격 교환·CSRF 발급/회전·유휴 활동 집계·쿠키 최종 규칙, Litpage 세션·로그아웃 전파, 관리자 지정 방식, 파일 저장소·잡 러너·부분 실패 정리, 감사 저장 경계, 백업 복원 재적용 절차·외부 보관 위치, 링크 키 보호 방식
- **표현·세부 정책**: 화면용 콘텐츠 형식, 폴더 크기(`null` 제안)·드라이브 사용량(휴지통/이전 버전 산입)·소유 목록 `isShared` 범위, 휴지통 원래 위치 소멸·이름 충돌 시 복원 및 경로 표기, 충돌 사본 2회차 명명 및 소유권, 로그인 전 언어·테마 임시 보관, 정지 상태 탈퇴 허용 여부, 커서·정렬·페이지 크기, 초기 시드(`categories`, `services`) 주입 방식 및 Litpage 초기 노출값, 실제 PostgreSQL 마이그레이션·질의 시험

---

## 6. 08 문서와 `0001_init.sql` 사이, 또는 07 YAML과 08 사이 불일치

발견된 불일치 없음.

---

## 7. 검토하지 못한 부분과 이유

- **실제 PostgreSQL 마이그레이션 실행, OpenAPI 린터, sqlx CLI, Mermaid 렌더링 검증**: 읽기 전용 검토 규칙 및 툴/환경 제한으로 정적 문서 대조만 수행하고 실제 실행·렌더링은 수행하지 못함(`[미확인]`).
- **설계서 23장 원문 및 `_reviews/_incoming-screen-data` 전체**: 작업 범위 외 참고 자료이므로 직접 대조하지 않음(`[미확인]`).