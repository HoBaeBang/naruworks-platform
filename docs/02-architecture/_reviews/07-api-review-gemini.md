<!-- naru-orch job=P2-8-api-07-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=95e702fc-b9b3-4031-bc90-28555aa93107 saved=2026-11-26T21:01:27+09:00 -->

## 1. 요약

- **검토 대상**: [README.md](../../../docs/02-architecture/07-api/README.md), [07-api.md](../../../docs/02-architecture/07-api/07-api.md), [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml)
- **심각도별 설계 결함 개수**:
  - `README.md`: blocking 0 / major 0 / minor 0
  - `07-api.md`: blocking 0 / major 0 / minor 0
  - `openapi.yaml`: blocking 0 / major 0 / minor 0
  - **총계**: **blocking 0 / major 0 / minor 0 (총 0건)**
- **명세 규모**: 총 **49개 operation**, **10개 태그**(`Auth`, `Account`, `Catalog`, `Legal`, `Litpage`, `Drive`, `Trash`, `Sharing`, `PublicLinks`, `Admin`).
- **디자인 불일치 건수**: **11건** (`DM-001`~`DM-011`, 주로 디자인 기준선 `4b66d1d`와 새 기획 기준선 `2f1db92` 간의 차이 및 일부 화면 메타 데이터 표현 차이).

---

## 2. 설계 결함 표

**남은 blocking/major 없음** (minor 포함 잔여 설계 결함 없음).

---

## 3. 점검 목록 — 검토 (a)

| 항목 | 판정 | 한 줄 근거 |
|---|---|---|
| 1. OpenAPI 3.1 및 개요·YAML 정합성 | **충족** | [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml#L1)이 `openapi: "3.1.0"`이며, 49개 operation의 경로·메서드·`operationId`·오류 스키마(`Error`)·`security`(`sessionCookie`, `csrfHeader`, 공개 경로 `[]`)가 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L16-L157)와 일치함. |
| 2. Must FR·AC 추적 및 매핑표·YAML 일치 | **충족** | [FRD.md](../../../docs/01-planning/frd/FRD.md#L48-L75)의 Must FR 26개와 [AC.md](../../../docs/01-planning/acceptance-criteria/AC.md)의 `AC-FR-*` 109개가 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L162-L189) 매핑표와 `openapi.yaml` 각 operation의 `근거 ID`에 빠짐없이 일치하게 추적됨. |
| 3. 인증 스킴 vs ADR 0004 | **충족** | axum 직접 Google 로그인·PostgreSQL 세션·Keycloak 제거, 정지 시 열린 세션 즉시 미종료 및 재로그인·갱신·Litpage 진입 차단(DEC-098), 유휴 7일/절대 30일(DEC-092), 현재 기기 로그아웃(DEC-094), SSO B-2 추천·09 확정 유보가 [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L19-L29)와 일치함. |
| 4. 업로드 규칙 (DEC-090·106·107·108) | **충족** | 단일 요청 업로드(분할·이어 올리기 없음), 0바이트 거부(`422 EMPTY_FILE` 및 폴더 `skipped`), 1 GiB 초과 시 개별 413/폴더 해당 파일만 `FILE_TOO_LARGE` 제외, 이름 충돌 `(1)` `(2)` 자동 번호가 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L46-L49)와 `uploadFile`·`uploadFolder`에 반영됨. |
| 5. 보관·테마·언어·원본 미전송 반영 | **충족** | 달력 날짜 30일(Q-085 `[미확인]` 병기), `Theme`(`system`/`light`/`dark`) 및 `Language`(`ko`/`en`) 계정 저장·우선(DEC-100·101·110·113), 다운로드 금지 시 `403 DOWNLOAD_FORBIDDEN` 및 `viewDriveFile`/`viewPublicLink` 화면용 응답(DEC-095·109·111)이 반영됨. |
| 6. `[미확인]` 유지 및 미검증 값 생성 금지 | **충족** | `RB-017`, `GAP-016·018·025`, `Q-081·085·087·091·092`를 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L215-L230)에 `[미확인]`으로 유지했고, 비밀 값은 CO-03 위치(`Google Cloud Console`)만 표기했으며 지어낸 ID가 없음. |
| 7. ADR 0003(axum·utoipa 5) 정합성 | **충족** | [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L12)가 `axum 0.8` 구현과 `utoipa 5` 생성 명세 원본임을 명시하며 [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md#L17)와 충돌하지 않음. |

---

## 4. 디자인 불일치 목록 — 검토 (b)

> 참고: [SOURCE.txt](../../../docs/02-architecture/_reviews/_incoming-screen-data/SOURCE.txt)에 따라 화면 데이터([screen-data-actions.md](../../../docs/02-architecture/_reviews/_incoming-screen-data/screen-data-actions.md), [screen-data-actions.csv](../../../docs/02-architecture/_reviews/_incoming-screen-data/screen-data-actions.csv))의 기준선은 develop `4b66d1d` 기획 v1.0이며, API 설계는 develop `2f1db92`(DEC-081~121)를 따릅니다.

### 상위 5건 요약
1. **DM-003 (WF-05 현재 위치 브레드크럼)**: 드라이브 화면 데이터에 현재 폴더 경로(브레드크럼) 표시가 있으나 `listDriveItems` 응답에 현재 폴더 경로/상위 체인 필드가 없음.
2. **DM-008 (WF-10·WF-12 정지 시 열린 세션)**: 디자인 목록에 구 결정("로그아웃할 때까지 사용", DEC-027)이 남아 있으나 API는 `DEC-098`에 따라 토큰 갱신·Litpage 진입을 차단함.
3. **DM-001 (WF-02 저장 폴더 선택 완료 여부)**: 디자인은 홈 화면 표시 데이터로 분류했으나 API는 `listServices`가 아닌 `getLitpageStorageFolder`/`enterLitpage`로 분리 제공함.
4. **DM-005 (WF-08 파일 이름·크기 메타)**: 디자인은 선택 데이터(`N`, `[미확인]`)로 등재했으나 `PublicLink` 스키마는 `downloadAllowed`만 반환함.
5. **DM-011 (WF-05·07 공유받은 파일 목록·편집)**: API는 `listDriveItems?scope=shared`, `readSharedEditableFile`, `saveSharedFileEdit`을 제공하나 디자인 목록에는 `충돌 사본 항목` 예시 외 별도 편집·수신 목록 동작이 빠져 있음.

### 전체 불일치 목록

| ID | 화면(WF/COMMON) | 디자인 항목(데이터/동작) | API 쪽 현황 | 제안 |
|---|---|---|---|---|
| DM-001 | WF-02 | 데이터 · `저장 폴더 선택 완료 여부` | `Service` 스키마에는 해당 불리언 필드가 없고 `GET /litpage/storage-folder` 또는 `POST /litpage/entry`의 `state`로 판정함 | 디자인 WF-02에서 진입 시 `enterLitpage`/`getLitpageStorageFolder` 호출 흐름으로 연결하거나, 필요 시 후속에서 `Service` 확장 검토 |
| DM-002 | WF-02 | 데이터 · `카테고리 목록` (이름과 **표시 순서**) | `Category` 스키마(`id`, `name`)에 명시적 순서 필드가 없고 배열 순서만 제공(순서 기준 `[미확인]`) | 서버 정렬 순서 보장 규약을 명시하거나 디자인에서 순서 기준 확정 시 필드 추가 검토 |
| DM-003 | WF-05 | 데이터 · `현재 위치` (현재 폴더 경로·브레드크럼) | `GET /drive/items`는 `items`·`nextCursor`만 반환하며 현재 폴더 경로/상위 체인 필드 및 단건 폴더 조회 API가 없음 | 프런트 탐색 상태로 유지할지, `DriveItemPage`에 `breadcrumbs`/`currentFolder`를 추가할지 후속 화면 계약에서 정리 |
| DM-004 | WF-05·WF-06 | 상태/비고 · `드라이브·휴지통 대상 선택·다중 선택` (4장 #8 `[미확인]`) | `DEC-116`에 따라 단건 조작(`trashDriveItem`, `restoreDriveItem`, `updateDriveFolder`)만 제공 | 디자인 문서를 `DEC-116` 단일 선택 기준으로 동기화 |
| DM-005 | WF-08 | 데이터 · `파일 이름·크기` (`N`, `[미확인]`) | `GET /public/links/{linkKey}`의 `PublicLink` 스키마는 `downloadAllowed`만 반환함 | 링크 화면에 파일명·크기 표시가 필요하면 디자인/기획 확정 후 `PublicLink`에 선택 필드 추가 검토 |
| DM-006 | WF-08 | 상태 · `상태 B 링크 열 수 없음` (사유별 구분 `[미확인]`) | `DEC-117`에 따라 사유(꺼짐·휴지통·삭제·탈퇴 삭제) 구분 없이 모두 `404 LINK_UNAVAILABLE` 동일 안내 반환 | 디자인 문서를 `DEC-117` 단일 안내 기준으로 동기화 |
| DM-007 | WF-08 | 동작 · `헤더 로그인 버튼` (로그인 후 복귀 위치 `[미확인]`) | `DEC-118`에 따라 `GET /auth/google/start`의 `returnTo`로 원래 링크 복귀 지원 | 디자인 문서를 `DEC-118` 원래 링크 복귀 기준으로 동기화 |
| DM-008 | WF-10·WF-12 | 동작 · `기존 세션 사용 지속` / `정지 확인` ("로그아웃할 때까지 사용") | `DEC-098`에 따라 열린 세션을 즉시 종료하지 않되 토큰 갱신(`refreshSession`)과 Litpage 진입(`enterLitpage`, `openLitpageDocument`)을 차단함 | 디자인 WF-10·WF-12의 구 `DEC-027` 문구를 `DEC-098` 기준으로 동기화 |
| DM-009 | WF-12 | 상태 · `검색·정렬·페이지 나눔` (`[미확인]`) | `DEC-121`에 따라 `GET /admin/members`는 `cursor`·`limit` 페이지 나눔만 제공하고 검색·정렬을 두지 않음 | 디자인 문서를 `DEC-121` 페이지 나눔 전용 기준으로 동기화 |
| DM-010 | WF-14 | 데이터/동작 · `카테고리 삭제 시 소속 서비스 처리`, `이름 번역`, `복수 카테고리` (`[미확인]`) | `DEC-115`·`DEC-120`에 따라 배정 서비스가 있으면 `409 CATEGORY_HAS_SERVICES`로 삭제 차단, 입력 이름 그대로 사용, 서비스당 카테고리 1개(`Service.categoryId`)만 허용 | 디자인 문서를 `DEC-115`·`DEC-120` 기준으로 동기화 |
| DM-011 | WF-05·WF-07 | 데이터/동작 · `공유받은 파일 목록 및 공동 편집` (`충돌 사본 항목`만 예시 기재) | `FR-DRV-006`·`DEC-112`에 따라 `listDriveItems(scope=shared)`, `readSharedEditableFile`, `saveSharedFileEdit`가 정의되어 있음 | 디자인 WF-05/07 또는 편집 진입 흐름에 공유받은 항목 조회·편집 저장 동작을 보완 |

*(참고: COMMON의 로고·회원 메뉴·문의 이메일·`Dev. Aslan0` 표시, 각 화면의 고정 제목/안내 문구, 순수 클라이언트 화면 이동 및 스크롤, 확인/취소 UI 분기는 프런트엔드 전용 항목으로 API 불일치에서 제외함.)*

---

## 5. 남은 `[미확인]` 목록

[07-api.md §미확인](../../../docs/02-architecture/07-api/07-api.md#L215-L230) 및 `openapi.yaml`에 유지된 미확인 항목은 다음과 같습니다.
- **기획·설계 공통 미결**: `RB-017`(Cloudflare CO-02 프록시 본문 한도와 1 GiB 단일 업로드 양립), `GAP-016`(기본 보안선 쿠키·CSRF 최종 규칙), `GAP-018`(지원 브라우저 ‘최신’ 정의 및 iOS 타 브라우저 취급), `GAP-025`(Litpage 자동 저장 지연·재시도·실패 정의·1 GiB 적용 및 무손실 패키징), `Q-081`(사업자·운영자 정보 표시 법적 의무), `Q-085`(달력 날짜 30일 시간대·경계 시각·시작일), `Q-087`(정지 회원 열린 세션의 갱신 주기·차단 최대 시간), `Q-091`(감사 기록 항목·보관 기간 및 로그 보관 법적 적정성), `Q-092`(전체 저장 용량 운영 경보 기준·수신 대상·방법).
- **09 인증/세션 설계 이관**: B-2 최종 채택, 내부 SSO 자격 교환 경로·페이로드, 통합 로그아웃 전파 방식, Litpage 자체 세션 수명, 나루 유휴 활동 집계, 쿠키 범위·속성, CSRF 발급·회전 방식(`refreshSession`, `enterLitpage`, `openLitpageDocument`, `saveLitpageResult`, `readSharedEditableFile`, `saveSharedFileEdit` 등 `x-contract-status: outline` 6개 operation).
- **기타 HTTP·화면 연계 미확인**: 배포 호스트, 커서 채택·기본/최대 페이지 크기·정렬 기준·커서 유효기간, API 버전 병행·폐기 일정, 다운로드 금지 시 화면용 파일 표현 형식, 로그인 전 언어·테마 임시 보관, 정지 상태 열린 세션의 탈퇴 가능 여부, 동시 편집 충돌 사본 소유권·편집 지원 형식, 휴지통 원래 위치 소멸·이름 중복 시 복원 정책, 폴더 크기 집계 방식, 카테고리 이름 길이·중복 규칙, 복구 안내 1회 표시 UI 상태 관리 방식, `getLegalDocument`의 `language` 생략 시 기본값 선택.

---

## 6. `07-api.md`와 `openapi.yaml` 사이 불일치

- **불일치 없음**: 49개 operation의 경로, HTTP 메서드, `operationId`, 태그(10개), `†`/`x-contract-status: outline` 표기(6개: `refreshSession`, `enterLitpage`, `saveLitpageResult`, `openLitpageDocument`, `readSharedEditableFile`, `saveSharedFileEdit`), 인증·CSRF 보안 스킴, 오류 코드(`400`/`401`/`403`/`404`/`409`/`413`/`422`/`500`/`503`), Must FR 26개 및 AC 109개 매핑이 양쪽 문서에서 모두 일치합니다.

---

## 7. 검토하지 못한 부분과 이유

- **OpenAPI 린터·스키마 검증기 실행**: 읽기 전용 검토 규칙 및 린터 미실행 조건에 따라 YAML/OpenAPI 3.1 문법의 기계적 린트 검증은 수행하지 못했습니다.
- **Rust / `utoipa` 컴파일 및 런타임 검증**: 구현 코드가 없는 명세 검토 단계이며 읽기 전용 환경이므로 `utoipa 5` 매크로 생성 결과 및 `axum 0.8` 라우터와의 실제 바인딩은 확인하지 못했습니다.
- **후속 ADR 및 09 설계 의존 경계**: 파일 저장소·잡 러너 ADR 및 09 인증/SSO 상세 설계가 아직 확정되지 않아 `x-contract-status: outline`으로 표시된 6개 operation의 내부 자격 교환·패키징 세부 스키마는 검증 대상에서 제외되었습니다.