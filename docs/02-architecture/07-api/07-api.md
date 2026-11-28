# 07 API 명세

| 항목 | 값 |
| --- | --- |
| 버전 | v0.4 |
| 일시 | 2026-11-26 (KST) |
| 상태 | 초안, Gemini 검토 대기 |
| 기획 기준선 | develop `2f1db92` |
| 입력 | [05 아키텍처 v0.4](../05-architecture.md) · [06 크레이트 구조 v0.4](../06-crate-layout.md) · [09 인증 v0.2](../09-auth.md) · [08 DB v0.2](../08-db/08-db-schema.md) |
| 연결 ADR | 0003 백엔드 스택 · 0004 인증/IdP와 Litpage 연동 |

[OpenAPI 3.1 계약](openapi.yaml)은 axum 0.8에서 구현하고 utoipa 5에서 생성할 명세의 원본이다. 07은 엔드포인트, 오류 모델, 버전 정책, 인증 스킴을 정의한다. HTTP 계층은 요청·인증·공개 오류 변환을 맡고 응용 계층은 회원 상태, 공유 권한, 파일 규칙을 판단한다. 파일 저장소와 잡 러너 구현은 별도 ADR 범위다. 경로·매개변수·본문·응답의 세부 형식은 07의 설계 제안이다. [05 아키텍처 §5–8](../05-architecture.md), [06 크레이트 구조 §5–7](../06-crate-layout.md), [ADR 0003](../../decisions/0003-backend-stack.md), [ADR 0004](../../decisions/0004-auth-idp-litpage.md)

## 변경 이력

| 버전 | 일시 | 변경 |
| --- | --- | --- |
| v0.1 | 2026-11-26 (KST) | 초안 작성 |
| v0.2 | 2026-11-26 (KST) | DM-003 브레드크럼과 DM-005 PublicLink 이름·크기 추가(자비스 결정). |
| v0.3 | 2026-11-26 (KST) | [09 인증 설계](../09-auth.md) 정합. 세션 쿠키·CSRF·갱신 헤더, 당시의 SSO 상태와 목록 페이지 크기 제안을 반영. |
| v0.4 | 2026-11-26 (KST) | 호배님 21:45 KST 결정으로 SSO B-1 반영. OP Discovery·authorize·token·JWKS·UserInfo·end_session과 Litpage 백채널 수신 계약 추가. |

## 인증·세션·CSRF

- axum 백엔드가 Google 로그인을 직접 처리하고 나루 PostgreSQL에서 회원 상태와 세션을 관리한다. Keycloak과 전용 DB는 제거한다. 신규 가입은 승인 없이 즉시 이용할 수 있다. CO-03 보관 위치는 Google Cloud Console이다. [ADR 0004](../../decisions/0004-auth-idp-litpage.md), [CO-03](../../01-planning/carry-over/README.md)
- `sessionCookie`는 로그인 회원 경로에 적용한다. 로그인 시작·콜백, 비회원 링크와 공개 문서는 로그인 없이 이용할 수 있다. 공개 링크는 주소의 불투명 키와 현재 파일·링크 상태를 매 요청 확인한다. 관리자 경로는 같은 세션 쿠키에 서버의 관리자 권한 검사를 추가한다.
- **쿠키·CSRF** · 09에 따라 `naru_session`은 `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`를 사용하고 `Domain`·`Expires`를 생략한다. `Max-Age`는 절대 만료까지 남은 초다. `sessionCookie`와 `csrfHeader`를 함께 요구한 작업은 쿠키와 `X-CSRF-Token`을 검증한다. 같은 오리진의 세션 조회 응답 헤더가 CSRF 값을 전달한다. 로그인·갱신마다 값을 회전하며, 갱신 성공 응답이 새 쿠키와 CSRF 헤더를 반환한다. 로그아웃 시 값을 폐기한다. OAuth 콜백의 로그인 흐름 검증에는 `state`를 사용한다. [09 §2](../09-auth.md#2-나루-세션-쿠키와-csrf)
- **세션 만료·정지** · 유휴 7일 또는 로그인 시작 후 절대 30일 중 먼저 도달하면 만료하고 재로그인한다(DEC-092, NFR-SEC-006). 재로그인·토큰 갱신·Litpage 진입에서 최신 회원 상태를 확인하고 정지 회원을 차단한다(DEC-098). 정지 확정만으로 열린 세션을 즉시 종료하지 않는다. 보관 기간 안에 정지 회원이 재가입하면 데이터는 복구하되 정지를 유지하고 세션 발급은 거부한다(DEC-114). [결정 로그](../../01-planning/02-decision-log/decision-log.md), [NFR](../../01-planning/nfr/NFR.md), [ADR 0004](../../decisions/0004-auth-idp-litpage.md)
- **통합 로그아웃** · 유효 세션이 있으면 현재 기기의 나루·Litpage 세션만 종료한다. 다른 기기의 세션은 유지한다(DEC-094). 이미 로그아웃한 상태에서는 추가 상태 변경 없이 완료한다. 확정된 SSO는 **B-1**이다. 1차 제안은 나루 OP의 백채널 통지와 Litpage RP 시작 로그아웃을 함께 적용한다. 갱신·Litpage 진입·문서 열기는 기존 `x-contract-status: outline`을 유지한다. [ADR 0004](../../decisions/0004-auth-idp-litpage.md), [09 통합 로그아웃](../09-auth.md#5-현재-기기-통합-로그아웃)
- **브라우저 흐름** · 비로그인 사용자의 보호된 화면 접근과 링크 화면에서 로그인한 경우에는 로그인 후 원래 주소로 복귀한다(DEC-118). 이미 로그인한 사용자가 로그인 화면 주소에 접근하면 홈으로 이동한다(DEC-119). 복귀 주소는 제안 필드 `returnTo`에 받은 허용된 동일 오리진 화면 상대 경로로 제한한다. 일반 회원의 관리자 *화면* 접근은 홈으로 이동하며, 관리자 *API*는 권한 오류를 돌려준다. [UF-01·04·06](../../01-planning/user-flow/UF.md), [AC](../../01-planning/acceptance-criteria/AC.md)

## Litpage B-1 OIDC 계약

**제안 배치.** 나루 issuer는 HTTPS 오리진 자체이며 실제 호스트는 [미확인]이다. Discovery는 발급자 루트의 표준 well-known 경로에 둔다. 그 외 OP 경로 및 RP 수신 경로는 이 명세의 제안이다. OpenAPI의 OP 경로별 `servers: [{url: "/"}]`는 앱 API의 `/api/v1` 접두사를 재정의한다. Discovery는 [미확인] 배포 호스트를 반영한 절대 HTTPS URL을 반환한다. Litpage 백채널은 별도 RP 오리진을 사용한다. OpenAPI의 `litpage.invalid`는 실제 등록 주소를 대신하는 예약 호스트다. [OIDC Discovery §3·4](https://openid.net/specs/openid-connect-discovery-1_0.html), [09 인증 v0.2](../09-auth.md)

| 위치와 경로 | 1차 제안 |
| --- | --- |
| OP `GET /.well-known/openid-configuration` | issuer, authorize·token·JWKS·UserInfo·end_session URL과 지원 메타데이터. |
| OP `GET, POST /oidc/authorize` | Authorization Code·`openid`·PKCE `S256`, 일회용 `state`·`nonce`. 등록된 redirect URI를 정확히 검증하고 나루 세션 및 최신 회원 상태를 확인한다. 세션이 없으면 나루 로그인 후 검증해 둔 요청을 재개한다. 정지 회원은 `access_denied`. |
| OP `POST /oidc/token` | 폼 POST, `client_secret_basic`. `authorization_code` 교환 또는 `refresh_token` 회전. 만료·폐기·정지·탈퇴 및 잘못된 grant는 `invalid_grant`. 성공 응답에 액세스·리프레시 토큰, 최초 코드 교환에만 ID 토큰을 반환한다. |
| OP `GET /oidc/jwks` | RS256 활성·회전 중 검증용 공개 키 집합. |
| OP `GET, POST /oidc/userinfo` | UserInfo 전용 Bearer로 RP에 `sub`만 반환하며 로그인·갱신의 주체 일치 확인에 쓴다. 토큰·나루 세션 또는 최신 회원 상태가 유효하지 않으면 `401 invalid_token`. |
| OP `GET, POST /oidc/end-session` | RP 시작 로그아웃. 요청과 일회용 확인을 검증하고 현재 브라우저의 동일 `sid`만 폐기한다. 정확히 등록된 복귀 주소로만 이동한다. |
| Litpage RP `POST /oidc/backchannel-logout` | 등록된 주소에서 서명된 폼 `logout_token`을 받아 대상 `sid`의 세션과 웹소켓을 폐기한다. 이미 폐기했어도 `200`. |

OIDC 프로토콜 오류는 앱 `Error` 봉투 대신 명세의 OAuth 오류 계약을 따른다. RP 클라이언트는 1차 수동 등록을 제안한다. 실제 등록 URI·배포 호스트·갱신 및 전파 실측은 [미확인]이다. 신규 진입의 진입 컨텍스트·언어·문서 전달 형식은 기존 Litpage API의 별도 [미확인] 계약으로 남긴다. [09 §4·5](../09-auth.md), [08 DB v0.2](../08-db/08-db-schema.md)

## 오류 형식

**제안** · JSON 오류는 `components.schemas.Error`에 정의한다. `code`는 클라이언트 분기용 코드, `message`는 공개 가능한 안내, `requestId`는 요청 상관 ID다. 응답의 `X-Request-Id`와 본문의 `requestId`는 같은 값으로 연결한다. 콜백의 정지 안내는 브라우저에 HTML 화면도 제공할 수 있다. 취소나 인증 실패의 정상 흐름은 로그인 화면으로 복귀한다. 로그와 공개 오류에는 세션·공유 링크 키, 시크릿, 원문 이메일, SQL 또는 공급자 세부 응답을 노출하지 않는다(PV-016, NFR-SEC-005). 연결 중단으로 응답을 수신하지 못할 수 있다. [06 §6](../06-crate-layout.md#6-오류-처리), [04 기술 NFR](../04-NFR-technical.md)

| 상태 | 적용 예 |
| --- | --- |
| `400` | 요청 형식이나 로그인 콜백 검증 실패 |
| `401` | 로그인 필요 `AUTH_REQUIRED`, 만료 `SESSION_EXPIRED` |
| `403` | 정지 검사 경계의 `MEMBER_SUSPENDED`, CSRF·관리자 권한·다운로드 차단, 숨긴 서비스 |
| `404` | 대상 조회 불가. 비회원 링크는 꺼짐·휴지통·삭제·탈퇴에 따른 삭제 사유 모두 `LINK_UNAVAILABLE`와 동일한 공개 메시지(DEC-117) |
| `409` | 폴더 생성·변경의 이름 중복, 표시 이름 사용 중·보관 중 예약, 서비스가 배정된 카테고리 삭제 |
| `413` | 개별 파일의 실수신 바이트가 한도를 초과. 06 §6의 매핑 |
| `422` | 개별 업로드 0바이트, 폴더 이름·이동 규칙 위반 등 |
| `500` / `503` | 처리 실패 / Litpage 진입·화면용 콘텐츠·자동 저장 중 구분 가능한 일시 실패 |

상태 코드와 코드 문자열은 07의 제안이며, 개별 파일의 한도 초과 `413`은 06 §6에 근거한다. 업로드 시 이름 충돌은 자동 번호를 적용한 저장 성공으로 반환한다. 동시 편집 충돌은 원본 폴더에 `이름 (충돌 사본)`을 저장한 성공으로 알리고, 버전은 최근 10개를 30일 보관한다(DEC-112). 회원 보기 공유에서 다운로드 금지이거나 탈퇴 보관 중인 소유 파일을 보는 경우, 비회원으로 다운로드 금지 링크를 보는 경우에는 화면용 표현만 내려준다(DEC-095·109·111). [BR-006~009·022·024·026](../../01-planning/business-rules/BR.md), [06 §6](../06-crate-layout.md#6-오류-처리)

## 목록과 페이지네이션

**제안** · 목록 응답은 `items`와 `nextCursor`를 사용한다. 첫 요청은 `cursor`를 생략한다. 다음 페이지는 같은 조회 조건으로 받은 커서를 넘기고, 마지막 페이지의 `nextCursor`는 `null`이다. 빈 목록은 `items: []`로 반환한다. `limit`는 정수 1~100이며, 생략 시 50을 적용한다. 범위 밖 또는 정수가 아닌 값은 `400 INVALID_REQUEST`로 처리한다. 기본값과 최댓값은 [09의 설계 제안](../09-auth.md#8-0708-정합과-페이지-크기)이다. 변경 중인 목록의 정렬 기준과 커서 유효기간은 [미확인]이다. 관리자 회원 목록은 페이지 나눔만 둔다(DEC-121). 공유 대상 회원의 전체 이메일 완전 일치 조회는 단건이며 관리자 목록 검색과 별개다. [FRD](../../01-planning/frd/FRD.md), [DEC-121](../../01-planning/02-decision-log/decision-log.md)

## 업로드·다운로드

- 개별 파일은 실수신 크기 1~1,073,741,824바이트(1 GiB, 양 끝 포함)를 단일 요청으로 올린다. 분할·이어 올리기 없이 중단 후 처음부터 재전송하며 미완료 파일은 목록에 나타나지 않는다(DEC-086·090). 드라이브 총용량 제한은 없다(BR-010).
- 폴더 통째 업로드는 현재 위치 아래에 폴더·하위 구조를 저장한다. 파일별로 한도를 적용하며 1 GiB 초과 파일만 제외하고 해당 파일을 안내한다(DEC-106). 0바이트 파일은 개별·폴더 업로드 모두 저장하지 않는다(DEC-107). **제안** · 폴더 안 0바이트 파일도 `skipped`에 사유와 함께 기록하고 유효한 나머지를 저장한다. 폴더 요청이 끊기면 전체 요청을 처음부터 재전송한다.
- 업로드 위치에 같은 이름의 파일·폴더가 있으면 첫 빈 번호 `(1)`, `(2)` 등을 붙인다. 폴더 업로드에도 적용한다(DEC-108). 별도 폴더 생성·이름 변경·이동의 중복 규칙은 BR-018 및 AC-FR-DRV-002-02를 따른다.
- **제안** · 개별 및 폴더 업로드는 각각 하나의 `multipart/form-data` 요청이다. 폴더는 상대 경로 목록과 대응 파일 바이트를 보낸다. 다운로드는 접근을 재검사한 뒤 허용된 파일 하나를 첨부 응답으로 보낸다. 폴더 통째 다운로드는 기획 범위 밖이다. [FRD FR-DRV-003](../../01-planning/frd/FRD.md), [AC](../../01-planning/acceptance-criteria/AC.md), [04 기술 NFR §4.1](../04-NFR-technical.md), [05 §6.1](../05-architecture.md), [06 §5–6](../06-crate-layout.md)

## 버전 정책

**제안** · URI에 호환성 단위인 `/api/v1`을 둔다. 클라이언트와 운영 도구가 경로에서 계약 버전을 식별할 수 있다. 하위 호환 변경은 같은 주 버전에서 배포하고, 필수 입력 추가나 기존 필드·동작 변경처럼 호환성을 깨는 변경은 새 주 버전에서 다룬다. 대안은 `Accept` 헤더의 미디어 타입 버전으로, 경로를 유지하는 대신 클라이언트와 관측에서 헤더를 구분해야 한다. 명세 개정 버전 `v0.4`는 URI의 `v1`과 별개다. 호환 버전 병행 기간과 폐기 일정은 [미확인]이다.

## 리소스별 엔드포인트

모든 경로는 제안 접두사 `/api/v1` 기준 상대 경로다. †는 후속 설계에서 확정할 경계의 윤곽이다.

### Auth · Google 로그인과 세션

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `GET /auth/google/start` | `startGoogleLogin` | Google 로그인 시작 |
| `GET /auth/google/callback` | `completeGoogleLogin` | Google 인증 결과 처리 |
| `GET /auth/session` | `getSession` | 현재 세션과 복구 안내 상태 조회 |
| `POST /auth/session/refresh` | `refreshSession` † | 세션 갱신 경계 |
| `POST /auth/logout` | `logoutCurrentDevice` | 현재 기기 통합 로그아웃 |

### Account · 계정·프로필

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `GET /account/profile` | `getProfile` | 본인 프로필 조회 |
| `PATCH /account/profile` | `updateProfile` | 표시 이름·언어·테마 저장 |
| `DELETE /account` | `withdrawAccount` | 회원 탈퇴 |

### Catalog · 홈·공통 헤더에 쓰는 카테고리·서비스

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `GET /catalog/categories` | `listCategories` | 홈·헤더 카테고리 목록 |
| `GET /catalog/services` | `listServices` | 이용 가능한 서비스 목록 |

### Legal · 공개 문서

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `GET /legal/{document}` | `getLegalDocument` | 이용약관·개인정보처리방침·라이선스 고지 조회 |

### Litpage · Litpage 진입·저장 폴더·자동 저장

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `POST /litpage/entry` | `enterLitpage` † | Litpage 신규 진입 |
| `GET /litpage/storage-folder` | `getLitpageStorageFolder` | Litpage 저장 폴더 설정 조회 |
| `PUT /litpage/storage-folder` | `setLitpageStorageFolder` | Litpage 저장 폴더 지정·변경 |
| `PUT /litpage/results/{resultId}` | `saveLitpageResult` † | Litpage 결과물 자동 저장 경계 |

### Drive · 드라이브 파일·폴더

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `GET /drive/items` | `listDriveItems` | 드라이브 파일·폴더 목록 |
| `POST /drive/folders` | `createDriveFolder` | 폴더 생성 |
| `PATCH /drive/folders/{folderId}` | `updateDriveFolder` | 폴더 이름 변경·이동 |
| `POST /drive/uploads/file` | `uploadFile` | 파일 한 개 업로드 |
| `POST /drive/uploads/folder` | `uploadFolder` | 폴더 통째 업로드 |
| `GET /drive/files/{fileId}/download` | `downloadDriveFile` | 권한이 있는 파일 원본 다운로드 |
| `GET /drive/files/{fileId}/view` | `viewDriveFile` | 회원용 화면 콘텐츠 조회 |
| `GET /drive/files/{fileId}/thumbnail` | `getDriveThumbnail` | 대표 썸네일 조회 |
| `POST /drive/files/{fileId}/litpage/open` | `openLitpageDocument` † | 드라이브 결과물을 Litpage로 열기 |

### Trash · 휴지통

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `DELETE /drive/items/{itemId}` | `trashDriveItem` | 파일 또는 폴더 한 개를 휴지통으로 이동 |
| `GET /drive/trash` | `listTrash` | 휴지통 목록 |
| `POST /drive/trash/{itemId}/restore` | `restoreDriveItem` | 휴지통 항목 한 개 복원 |

### Sharing · 회원 공유 및 공개 링크 관리

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `POST /drive/files/{fileId}/share-recipient-lookup` | `findShareRecipient` | 공유할 활동 회원 찾기 |
| `GET /drive/files/{fileId}/shares` | `listMemberShares` | 파일을 공유받는 회원 목록 |
| `PUT /drive/files/{fileId}/shares/{memberId}` | `setMemberShare` | 회원 공유 설정 |
| `DELETE /drive/files/{fileId}/shares/{memberId}` | `revokeMemberShare` | 회원 공유 회수 |
| `GET /drive/files/{fileId}/edit-content` | `readSharedEditableFile` † | 편집 권한이 있는 공유 파일 읽기 |
| `POST /drive/files/{fileId}/revisions` | `saveSharedFileEdit` † | 공유 파일 편집 결과 저장 |
| `GET /drive/files/{fileId}/link` | `getDriveLink` | 파일 공개 링크 설정 조회 |
| `PUT /drive/files/{fileId}/link` | `enableDriveLink` | 파일 공개 링크 켜기·설정 |
| `DELETE /drive/files/{fileId}/link` | `disableDriveLink` | 파일 공개 링크 끄기 |

### PublicLinks · 비회원 링크 보기

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `GET /public/links/{linkKey}` | `getPublicLink` | 비회원 링크 보기 상태 조회 |
| `GET /public/links/{linkKey}/view` | `viewPublicLink` | 비회원 화면용 콘텐츠 조회 |
| `GET /public/links/{linkKey}/download` | `downloadPublicLink` | 허용된 공개 링크 원본 다운로드 |

### Admin · 관리자 회원·오픈소스·카테고리

| 메서드·경로 | operationId | 용도 |
| --- | --- | --- |
| `GET /admin/members` | `listAdminMembers` | 관리자 회원 목록 |
| `PUT /admin/members/{memberId}/suspension` | `setMemberSuspension` | 회원 정지·해제 |
| `GET /admin/open-sources` | `listAdminOpenSources` | 관리자 오픈소스 노출 목록 |
| `PUT /admin/open-sources/{serviceId}/visibility` | `setOpenSourceVisibility` | 오픈소스 숨김·노출 |
| `GET /admin/categories` | `listAdminCategories` | 관리자 카테고리 목록 |
| `GET /admin/service-assignments` | `listServiceAssignments` | 관리자 서비스 배정 목록 |
| `POST /admin/categories` | `createCategory` | 카테고리 추가 |
| `PATCH /admin/categories/{categoryId}` | `renameCategory` | 카테고리 이름 변경 |
| `DELETE /admin/categories/{categoryId}` | `deleteCategory` | 배정된 서비스가 없는 카테고리 삭제 |
| `PUT /admin/services/{serviceId}/category` | `assignServiceCategory` | 서비스의 카테고리 배정 변경 |

## Must FR 및 AC 매핑

기획 기준선의 [FRD §3](../../01-planning/frd/FRD.md), [AC](../../01-planning/acceptance-criteria/AC.md), [추적 매트릭스](../../01-planning/traceability/matrix.csv)를 대조했다. Must FR 26개와 그 AC 109개가 아래 표에 있다. 번호는 같은 행의 FR ID에 붙는 AC 끝 두 자리다. 예를 들어 `FR-AUTH-001`의 `01`은 `AC-FR-AUTH-001-01`이다. operationId별 실제 경로는 바로 위 목록을 참조한다.

| Must FR | 기획 요구 | operationId → AC 번호 |
| --- | --- | --- |
| FR-AUTH-001 | Google 통합 로그인으로 가입·로그인하고 즉시 사용 | `startGoogleLogin` → 01·02·04·05·06<br>`completeGoogleLogin` → 01·02·03·05<br>`getSession` → 02·06<br>`updateProfile` → 04 |
| FR-AUTH-002 | 통합 로그아웃 | `logoutCurrentDevice` → 01·02·03 |
| FR-AUTH-003 | 회원 탈퇴 | `withdrawAccount` → 01·02·03 |
| FR-AUTH-004 | 탈퇴 후 30일 안 재가입 시 데이터 복구 | `completeGoogleLogin` → 01·02·04<br>`getSession` → 01·03<br>`setMemberSuspension` → 04 |
| FR-AUTH-005 | 정지 회원의 재로그인·토큰 갱신·Litpage 진입 차단(DEC-098) | `completeGoogleLogin` → 01·02·03<br>`getSession` → 02<br>`refreshSession` → 02·04<br>`enterLitpage` → 05<br>`openLitpageDocument` → 05<br>`setMemberSuspension` → 01·02·04·05 |
| FR-AUTH-006 | 계정 설정 화면 | `getProfile` → 01<br>`withdrawAccount` → 01 |
| FR-HOME-001 | 로그인 후 서비스 목록 홈 | `completeGoogleLogin` → 01<br>`getSession` → 01<br>`listCategories` → 01<br>`listServices` → 01·02<br>`setOpenSourceVisibility` → 02 |
| FR-HOME-002 | 용도별 카테고리(기본 문서·저장소) | `listCategories` → 01·02<br>`listServices` → 01·02<br>`setOpenSourceVisibility` → 02<br>`assignServiceCategory` → 01·02 |
| FR-SHELL-001 | 공통 헤더 | `startGoogleLogin` → 05·06<br>`getSession` → 01·04<br>`logoutCurrentDevice` → 01<br>`listCategories` → 01·03<br>`listServices` → 01·02·03<br>`enterLitpage` → 01<br>`getPublicLink` → 05·06<br>`listAdminMembers` → 04<br>`setOpenSourceVisibility` → 02<br>`assignServiceCategory` → 03 |
| FR-SHELL-002 | 공통 푸터 | `getLegalDocument` → 01·02·03·04<br>`getPublicLink` → 02 |
| FR-SHELL-003 | 프로필 화면 | `getProfile` → 01·04·05·06·09<br>`updateProfile` → 02·03·04·05·07·08·09<br>`withdrawAccount` → 07·08 |
| FR-OSS-001 | Litpage를 1차 기본 오픈소스로 연동·사용 | `logoutCurrentDevice` → 01<br>`updateProfile` → 03<br>`listServices` → 02<br>`enterLitpage` → 01·02·03<br>`openLitpageDocument` → 02<br>`setOpenSourceVisibility` → 02 |
| FR-OSS-002 | 서비스별 저장 폴더 선택·변경 | `enterLitpage` → 01·02<br>`getLitpageStorageFolder` → 01·02·03·04<br>`setLitpageStorageFolder` → 01·03·04<br>`saveLitpageResult` → 03<br>`listDriveItems` → 01<br>`createDriveFolder` → 01 |
| FR-OSS-003 | 연동 오픈소스 결과물의 드라이브 자동 저장 | `setLitpageStorageFolder` → 01<br>`saveLitpageResult` → 01·02 |
| FR-DRV-001 | 나루 드라이브 화면 | `listDriveItems` → 01·02·03<br>`uploadFile` → 02·03<br>`uploadFolder` → 03 |
| FR-DRV-002 | 폴더 생성·이름 변경·이동 | `createDriveFolder` → 01·02<br>`updateDriveFolder` → 01·02 |
| FR-DRV-003 | 파일·폴더 업로드·다운로드 | `listDriveItems` → 04·08<br>`uploadFile` → 01·02·03·05·07·08<br>`uploadFolder` → 03·04·05·06·07·08<br>`downloadDriveFile` → 01<br>`downloadPublicLink` → 01 |
| FR-DRV-004 | 삭제와 휴지통(30일 후 자동 삭제) | `withdrawAccount` → 07<br>`trashDriveItem` → 01·03·08<br>`listTrash` → 01·02·04·05·06·07<br>`restoreDriveItem` → 01·02·03·06·08<br>`getPublicLink` → 03<br>`viewPublicLink` → 03<br>`downloadPublicLink` → 03 |
| FR-DRV-005 | Litpage 문서를 누르면 Litpage로 열기 | `listDriveItems` → 02<br>`openLitpageDocument` → 01·02<br>`setOpenSourceVisibility` → 02 |
| FR-DRV-006 | 회원 공유(보기/편집 권한 선택, 보기 시 다운로드 선택) | `withdrawAccount` → 06·07<br>`listDriveItems` → 01·07<br>`downloadDriveFile` → 01·06·07<br>`viewDriveFile` → 01·06·07<br>`findShareRecipient` → 02·03<br>`listMemberShares` → 01·04·07<br>`setMemberShare` → 01·02·03·04<br>`revokeMemberShare` → 02·04<br>`readSharedEditableFile` → 01·05·06·07<br>`saveSharedFileEdit` → 01·05·06·07 |
| FR-DRV-007 | 비회원 링크 공유(보기만, 다운로드 선택, 만료·비밀번호 없음) | `startGoogleLogin` → 04<br>`withdrawAccount` → 06<br>`getLegalDocument` → 03<br>`getDriveLink` → 01·02<br>`enableDriveLink` → 01·02·05<br>`disableDriveLink` → 02·06<br>`getPublicLink` → 01·02·03·04·05·06<br>`viewPublicLink` → 01·05·06<br>`downloadPublicLink` → 01·05·06 |
| FR-DRV-008 | 썸네일 미리보기·파일 형식 아이콘 | `listDriveItems` → 02·03<br>`getDriveThumbnail` → 01·02·03 |
| FR-ADM-001 | 회원 목록 조회 | `listAdminMembers` → 01·02·03·04 |
| FR-ADM-002 | 회원 정지·해제 | `setMemberSuspension` → 01·02·03·04 |
| FR-ADM-003 | 오픈소스 노출·숨김 | `listServices` → 01·02<br>`listAdminOpenSources` → 01·03<br>`setOpenSourceVisibility` → 01·02·04 |
| FR-ADM-004 | 카테고리와 서비스 배정 관리 | `listCategories` → 01·02<br>`listServices` → 01·02<br>`listAdminCategories` → 01·02·03·04<br>`listServiceAssignments` → 01·02·04<br>`createCategory` → 03<br>`renameCategory` → 02·03<br>`deleteCategory` → 03·04<br>`assignServiceCategory` → 01·02 |

화면 수락 기준 중 로그인 전 언어 전환, 로그인·탈퇴·복구 후 화면 이동과 안내, 헤더·푸터 표시, 확인·취소, 마우스 오버, 관리 화면으로의 이동은 연결된 API 응답과 함께 프런트에서 검증한다(UF-01~07). 탈퇴·휴지통 만료와 정지·숨김 감사 기록은 해당 리소스의 처리 결과로 검증한다. 문의 양식, 정리 실행, 감사 로그 조회, 버전 탐색용 API는 1차 요구에 없다. [UF](../../01-planning/user-flow/UF.md), [FRD §10](../../01-planning/frd/FRD.md), [AC](../../01-planning/acceptance-criteria/AC.md)

| 관련 비기능 AC | 검증 위치 |
| --- | --- |
| AC-NFR-SEC-001-01, AC-NFR-SEC-002-01, AC-NFR-SEC-006-01 | `logoutCurrentDevice`, `setMemberSuspension`, `completeGoogleLogin`, `refreshSession`, `enterLitpage`, `openLitpageDocument`, `getSession`의 기기·상태·만료 경계 |
| AC-NFR-SEC-003-01, AC-NFR-SEC-004-01 | `getPublicLink`, `viewPublicLink`, `downloadPublicLink`, `withdrawAccount`, `completeGoogleLogin`의 접근·보관·재가입 경계 |
| AC-NFR-PERF-002-01, AC-NFR-PERF-003-01, AC-NFR-PERF-003-02 | `uploadFile`, `uploadFolder`, 다운로드, 목록·썸네일·Litpage 로딩 시험. 화면 p95와 제외 구간은 04 기준 |
| AC-NFR-I18N-001-01, AC-NFR-I18N-002-01, AC-NFR-I18N-003-01, AC-NFR-USAB-002-01 | 로그인 전에는 영어 기기에서 영어, 그 외 한국어로 시작하며 로그인 화면에서 전환한다. `getProfile`, `updateProfile`로 계정 언어를 읽고 저장하며 로그인 후에는 설정된 계정 언어를 우선한다(DEC-100·110). `enterLitpage`는 나루 언어를 전달한다. 테마는 계정에 저장하고 나루와 `getLegalDocument`로 제공하는 법적 문서 화면에 적용한다. 시스템 모드는 기기 설정을 따르며 Litpage 테마는 계정 설정 대상에서 제외한다(DEC-101·113). |
| AC-NFR-SEC-005-01·02, 규모·오류율·가용률·백업·로그·저장 용량 경보·브라우저·반응형·접근성 AC | 문서 검토와 운영·화면 시험. 용량 경보는 업로드 허용 여부에 영향을 주지 않는다(DEC-105). [04 기술 NFR](../04-NFR-technical.md) |

## 디자인 목록과의 차이(참고)

보조 입력은 디자인 워크트리 미커밋 자료이며 기준선은 develop `4b66d1d` 기획 v1.0이다. 아래 계약의 기능 범위에는 develop `2f1db92`을 적용했다. [SOURCE.txt](../_reviews/_incoming-screen-data/SOURCE.txt), [화면 데이터·동작](../_reviews/_incoming-screen-data/screen-data-actions.md), [CSV](../_reviews/_incoming-screen-data/screen-data-actions.csv)

| 화면 자료의 열린 항목 | 07에 반영한 기준 |
| --- | --- |
| DM-003 드라이브 브레드크럼 | `GET /drive/items`의 `DriveItemPage`에 필수 `breadcrumbs`를 반영했다. 제안 형식은 불투명 폴더 식별자 `id`와 `name`을 담은 `Breadcrumb` 배열이다. 루트 기준 첫 폴더부터 현재 폴더까지 포함하며, 루트 목록과 폴더 조회가 아닌 받은 공유 목록은 빈 배열이다. |
| DM-005 공개 링크 파일 정보 | `GET /public/links/{linkKey}`의 `PublicLink`에 대상 파일의 필수 `name`과 `sizeBytes`를 반영했다. `downloadAllowed`도 필수다. |
| DM-001 Litpage 진입 흐름 | `getLitpageStorageFolder`와 `enterLitpage`를 분리한 현재 구조를 따른다. |
| DM-008 정지 차단 시점 | API는 DEC-098을 적용한다. 디자인에서 DEC-098을 반영할 예정이다. |
| DM-002·004·006·007·009·010·011 [미확인] | 디자인과의 대응은 후속 검토 사항이다. |
| WF-05·06 대상 선택, 다중 선택 | 항목 한 개씩 조작한다(DEC-116). |
| WF-08 링크 불가 사유별 안내·로그인 뒤 복귀 | 링크 불가 안내 일원화와 원래 링크로의 복귀를 반영했다(DEC-117·118). 로그인 상태의 로그인 주소 접근은 홈으로 보낸다(DEC-119). |
| WF-14 카테고리 삭제 시 배정 처리, 카테고리 이름 번역·복수 배정 | 배정된 서비스가 있으면 삭제를 차단한다. 입력 이름 그대로, 서비스당 카테고리 하나를 사용한다(DEC-115·120). |
| WF-12 검색·정렬·페이지 나눔 | 페이지 나눔만 반영했다(DEC-121). |
| WF-01 로그인 전 언어, WF-04 Litpage 언어·저장 형식 | 로그인 후 계정 언어 우선, Litpage 언어 동기화를 반영했다(DEC-100·110). ADR 0004는 Markdown·CSV와 무손실 재열기를 명시하며 패키징은 검증 대기다. |

버튼 자리 표시, 로딩, 진행률, 터치에서 별도 미리보기 등 화면 목록의 제안만으로 새 API를 추가하지 않았다. [결정 로그](../../01-planning/02-decision-log/decision-log.md), [ADR 0004](../../decisions/0004-auth-idp-litpage.md)

## 미확인

| 항목 | 확인할 내용 |
| --- | --- |
| RB-017 [미확인] | CO-02 Cloudflare 프록시 경로·본문 한도와 1 GiB 단일 요청의 양립 여부. |
| GAP-016 [미확인] | 기본 보안선. PV-022·023은 04 제안값이며 쿠키·CSRF 계약은 09 §2에 둔다. |
| GAP-018 [미확인] | 지원 브라우저의 ‘최신’ 정의와 iOS 타 브라우저 취급. |
| GAP-025 [미확인] | Litpage 자동 저장 지연·재시도·실패 정의·1 GiB 적용, 무손실 패키징과 호출 계약. |
| Q-081 [미확인] | 사업자·운영자 정보 표시 의무 및 정식 배포 전 법적 확인. |
| Q-085 [미확인] | 휴지통·탈퇴 보관 달력 날짜 30일의 시간대·경계·시작일 산입. |
| Q-087 [미확인] | 이미 열린 정지 회원 세션의 갱신 주기와 차단까지 최대 시간. |
| Q-091 [미확인] | 관리자 감사 기록 항목·보관 기간, 로그 보관 및 감사 기록의 법적 적정성. |
| Q-092 [미확인] | 전체 저장 용량 알림 기준, 수신 대상 및 전달 방법. |
| 09 연계 [미확인] | B-1 배포·RP 등록, 통합 로그아웃 전파와 Litpage 갱신 주기 실측, 나루 유휴 활동 집계 경로, CSRF 키 운영. |
| 그 밖의 HTTP·화면 연계 [미확인] | 배포 호스트, 목록 정렬과 커서 유효기간, 버전 폐기 일정, 화면용 파일 표현, 로그인 전 언어·테마 임시 보관, 정지 상태 탈퇴, 충돌 사본 소유권·편집 형식, 휴지통 원래 위치 소멸·이름 중복 시 복원, 폴더 크기, 카테고리 이름 상세 규칙, 복구 안내 표시 상태. |
| 설계서 23장 원문 [미확인] | 이 작업의 지시문에 제시된 07 범위와 README 위치를 반영했다. |

[열린 질문](../../01-planning/02-decision-log/open-questions.md), [04 기술 NFR](../04-NFR-technical.md), [05 §11](../05-architecture.md), [06 §10](../06-crate-layout.md), [ADR 0004](../../decisions/0004-auth-idp-litpage.md)
