<!-- naru-orch job=P2-5-auth-options-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=d55d1ba1-8b2e-42c6-b0e6-7620c7eedeeb saved=2026-11-19T14:28:08+09:00 -->

결정을 내리지 않은 상태로, 확인된 문서와 코드 사실만을 근거로 선택지를 정리했습니다.

---

### 1. 요약
현재 저장소에는 기존 Spring Boot + Keycloak 기반 인증 및 부분 수정된 Litpage 코드가 존재하나, 신규 Rust(`axum`) 백엔드 전환과 1차 기획 기준선(`4b66d1d` 및 2026-11-19 커밋 전 확정 사항)에 맞춰 **① 인증/IdP 방식(Keycloak 유지 vs `axum` 자체 인증 등, DEC-008)**, **② 기존 Litpage 수정 코드 재사용 여부(DEC-008)**, **③ Litpage 결과물의 나루 드라이브 저장 파일 형식(DEC-026 설계 이관)**을 선택해야 하는 단계이며 본 문서는 결정을 내리지 않고 선택지와 판단 근거만 정리합니다.

---

### 2. 현재 사실 (인용)
- **Litpage 정체**: 오픈소스 [Litpage](https://github.com/litmers-dev/litpage)(MIT, 씨그로 주식회사)의 원본 커밋 `931cd28`(2026-10-26)을 복사·수정한 사본이며 업스트림을 추적하지 않습니다([services/litpage/NARU.md](../../../services/litpage/NARU.md#L3-L6)). Node 26 + Hono + `node:sqlite` + WebSocket 서버와 React 19 + Vite 클라이언트로 구성된 단일 프로세스 앱입니다([services/litpage/docs/architecture.md](../../../services/litpage/docs/architecture.md#L1-L13)).
- **현재 인증 (Naru & Keycloak)**: [README.md](../../../README.md#L72-L77) 기준 Keycloak 기반 Google 중앙 로그인이 운영 중이며, [docker-compose.yml](../../../docker-compose.yml#L73-L118)에 `keycloak`(`quay.io/keycloak/keycloak:26.8.1`)과 전용 `keycloak-postgres`(`postgres:16-alpine`), 기존 `backend`(Spring Boot)가 정의되어 있습니다. 신규 Rust 백엔드는 `axum` 0.8.x + `sqlx` 0.8.x + `utoipa` 5.x로 결정되었으나([docs/decisions/0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md#L9)), 인증/IdP 어댑터(`naru-adapters::identity`)는 `[ADR 대기]` 상태입니다([docs/02-architecture/06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L89)).
- **구문서와 현 기획의 모순**: 구문서([docs/architecture/open-source-integration.md](../../../docs/architecture/open-source-integration.md#L53), [docs/architecture/idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L33))는 초대 코드·`PENDING`·관리자 승인(`APPROVED`) 후 `member` 역할 부여 및 5GB 무료 요금제·카탈로그를 전제하지만, 현 기획(`4b66d1d`)은 **가입 즉시 사용(관리자 승인 없음, DEC-005)**, **1차 드라이브 총용량 제한 없음(DEC-010)**, **카탈로그·Naru Calendar 제외(DEC-006)**로 해당 전제를 폐기했습니다([docs/01-planning/02-decision-log/decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L9-L14)).
- **현재 Litpage 인증·세션·로그아웃**: [services/litpage/apps/server/src/oidc.ts](../../../services/litpage/apps/server/src/oidc.ts#L1-L239)가 Keycloak OIDC Authorization Code + PKCE(`S256`)를 수행하고 `email_verified === true`와 `realm_access.roles`의 `member` 역할을 검사해 `idp_identities` 테이블에 `sub`를 매핑합니다. 세션은 [services/litpage/apps/server/src/auth.ts](../../../services/litpage/apps/server/src/auth.ts#L6-L62)에서 SQLite `sessions` 테이블과 `lit_session` 쿠키(수명 7일 고정, 활동 시 유휴 연장 없음)로 관리합니다. 로그아웃(`/auth/logout`)은 `lit_session`을 삭제한 뒤 `lit_idt` 쿠키에 보관된 ID 토큰을 `id_token_hint`로 붙여 Keycloak `end_session_endpoint`로 리다이렉트하는 RP 로그아웃이며, **백채널 로그아웃은 구현되어 있지 않습니다**([oidc.ts](../../../services/litpage/apps/server/src/oidc.ts#L222-L238), [NARU.md](../../../services/litpage/NARU.md#L51)).
- **현재 Litpage 저장 및 내보내기/가져오기**: 문서는 나루 드라이브 파일이 아닌 SQLite(`litpage.db`)의 `records` 테이블(JSON 데이터 + `changes` 로그)과 로컬 `DATA_DIR/files`에 저장됩니다([services/litpage/apps/server/src/db.ts](../../../services/litpage/apps/server/src/db.ts#L8-L80)). 내보내기(`ExportFormat`)는 `'markdown' | 'html' | 'pdf'`(데이터베이스는 CSV)를 지원하고([services/litpage/apps/server/src/content/render.ts](../../../services/litpage/apps/server/src/content/render.ts#L1-L21)), 가져오기(`IMPORT_EXT`)는 `.md`, `.markdown`, `.txt`, `.csv`, `.tsv`, `.html`, `.htm`, `.docx`, `.pdf`, `.xlsx`, `.opml`, `.enex`, `.json` 및 내보내기 구조 ZIP을 지원합니다([services/litpage/apps/server/src/api/modules/import.ts](../../../services/litpage/apps/server/src/api/modules/import.ts#L10-L39)).
- **나루 드라이브 자동 저장 상태**: **미구현**입니다. [open-source-integration.md](../../../docs/architecture/open-source-integration.md#L107)는 연동 방식을 미결로 두고 있으며, [services/litpage/NARU.md](../../../services/litpage/NARU.md#L13-L47)의 수정/남은 일 목록 및 `services/litpage/` 코드 전반에 드라이브 자동 저장 구현이 없습니다.

---

### 3. 요건 대조표

| 요건 항목 | 기획 ID | 현재 구현 상태 | 근거 경로 |
|---|---|---|---|
| Google 로그인 (1차 단일 수단, 즉시 가입) | FR-AUTH-001, DEC-005·007, BR-001·002 | **부분** (Keycloak 경유 Google 로그인은 운영 중이나, 구 Spring 코드는 초대·승인 전제이며 신규 Rust 백엔드 미구현) | [README.md](../../../README.md#L72), [idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L33), [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L89) |
| 통합 로그인 (나루 ↔ Litpage 단일 인증) | DEC-001, FR-AUTH-001, FR-OSS-001, BR-003 | **부분** (Litpage OIDC 코드는 있으나 compose·Keycloak realm JSON에 `litpage` 클라이언트 미등록, 미배포) | [oidc.ts](../../../services/litpage/apps/server/src/oidc.ts#L145-L219), [NARU.md](../../../services/litpage/NARU.md#L45-L46), [idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L238) |
| 통합 로그아웃 (전파 p99 ≤ 5초, API p95 ≤ 2초) | FR-AUTH-002, DEC-015, NFR-SEC-001, PV-017 | **없음** (Litpage RP 로그아웃만 구현, 나루→Litpage 백채널·5초 전파 미구현, #80 미해결) | [open-source-integration.md](../../../docs/architecture/open-source-integration.md#L59-L67), [oidc.ts](../../../services/litpage/apps/server/src/oidc.ts#L222-L238), [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L106) |
| 정지 시 리프레시 회전·Litpage SSO 진입 차단 **(커밋 전)** | FR-AUTH-005, FR-ADM-002, BR-005, 05 §6.4 | **없음** (구 Spring은 `member` 역할 제거만 수행, 리프레시 회전·Litpage 진입 시점 정지 검사 미구현) | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L222-L241), [idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L175-L183) |
| 세션 유휴 7일·절대 30일 상한 **(커밋 전)** | PV-018, 05 §6.4, GAP-012 | **부분** (Litpage `lit_session`은 생성 후 7일 고정이며 유휴 연장·절대 30일 미구현; Keycloak 로컬 idle 30분/max 10시간으로 불일치) | [auth.ts](../../../services/litpage/apps/server/src/auth.ts#L7-L49), [open-source-integration.md](../../../docs/architecture/open-source-integration.md#L61-L65) |
| 한국어 / 영어 (ko/en) 지원 | DEC-039·045·052, NFR-I18N-001~003 | **부분** (Litpage는 ko/en UI 및 카탈로그 보유, Naru 신규 프런트엔드 미구현) | [services/litpage/README.ko.md](../../../services/litpage/README.ko.md#L13-L46), [services/litpage/docs/architecture.md](../../../services/litpage/docs/architecture.md#L75-L76), [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L271) |
| CO-03 (소셜 로그인 클라이언트 ID/시크릿 위치) | PRD CO-03, NFR-SEC-005 | **있음** (루트 `.env` 및 compose 환경변수 이름으로 존재 위치 확인, 값은 미열람) | [PRD.md](../../../docs/01-planning/prd/PRD.md#L149), [docker-compose.yml](../../../docker-compose.yml#L106-L107) |
| Litpage 결과물 나루 드라이브 자동 저장 (형식 미정) | FR-OSS-001·002·003, DEC-004·026 | **없음** (Litpage는 SQLite에만 저장하며 드라이브 연동 코드 없음) | [open-source-integration.md](../../../docs/architecture/open-source-integration.md#L107), [NARU.md](../../../services/litpage/NARU.md#L13-L47) |

---

### 4. IdP 선택지

> 모든 선택지는 **관리자 승인 없는 즉시 가입(DEC-005)**과 **1차 총용량 제한 없음(DEC-010)**을 전제로 하며, 구문서의 초대·승인·5GB 가정을 전제하지 않습니다. (참고: **PV-003의 64 MiB는 업로드당 서버 RSS 증가 한도**이지 호스트 전체 RAM 한도가 아닙니다 — [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L306).)

#### 선택지 A. Keycloak 유지 — Naru(`axum`)와 Litpage가 OIDC RP
- **한 줄 정의**: 기존 `docker-compose.yml`의 Keycloak을 중앙 IdP로 유지하고, 신규 Rust(`axum`) 백엔드와 Litpage가 각각 OIDC RP(신뢰 당사자)로 붙는 구조.
- **장점**:
  - 기존 Google 연동(`naru-browser` 흐름, 화면 없는 303 리다이렉트)과 운영 경험이 이미 존재함([idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L81)).
  - Litpage의 [oidc.ts](../../../services/litpage/apps/server/src/oidc.ts#L1-L239)가 이미 Keycloak OIDC + PKCE 기준으로 작성되어 있음.
  - 향후 다른 오픈소스 추가 시 표준 OIDC 클라이언트로 연결하기 쉬움.
- **단점**:
  - 단일 서버에 Java 기반 Keycloak + 전용 `keycloak-postgres` 컨테이너가 상시 떠 있어야 함([docker-compose.yml](../../../docker-compose.yml#L73-L118)).
  - realm 파일(`--import-realm`)이 최초 생성 시에만 반영되어 설정 변경이 콘솔·스크립트 이원화됨([idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L127)).
  - 사용자 `sub`와 회원 상태(정지·탈퇴 30일 복구)가 Keycloak DB와 Naru PostgreSQL에 이중 관리됨.
- **단일 서버 운영 부담**: `keycloak` + `keycloak-postgres` 2개 컨테이너 추가 유지 필요. 문서는 Keycloak 시험용 개발 모드 메모리 **약 800 MiB**를 기록하며 운영 모드(`start`) 사용량은 **미측정**입니다([idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L93)).
- **PV-017 충족 방법**:
  - 나루 로그아웃 시 Keycloak `end_session_endpoint` 호출 + Keycloak Back-Channel Logout으로 Litpage `/auth/backchannel-logout`(신규 구현 필요)에 로그아웃 토큰을 전달해 `lit_session` 즉시 삭제, 또는 Litpage 세션을 5분 이하 단기 토큰 재검증으로 변경해야 함. (단, Litpage 백채널 로그아웃 지원과 5초 p99 달성 여부는 `[미확인]`.)
- **PV-018 세션 상한 강제 위치**: Keycloak `SSO Session Idle`(7일) / `SSO Session Max`(30일) + Naru 앱 세션 저장소(유휴 7일·절대 30일) + Litpage 세션(`auth.ts` 7일 고정 → 유휴 7일·절대 30일로 정렬 필요). 세 곳의 수명이 어긋나면 재로그인/세션 잔존 문제가 발생함([open-source-integration.md](../../../docs/architecture/open-source-integration.md#L59-L65)).
- **정지 차단 구현 지점**(커밋 전 확정 기준): Naru `axum`이 리프레시 토큰 회전 요청 및 Litpage SSO 진입 전 Naru DB 회원 상태(`suspended`)를 조회해 차단(05 §6.4). 동시에 Keycloak `naru-api-admin`으로 `member` 역할 제거/세션 무효화를 동기화해야 Litpage 직접 재진입도 막힘.
- **Litpage SSO 실현 가능성**: 기존 `oidc.ts`를 그대로 활용 가능. 다만 `docker-compose.yml` 및 realm JSON에 `litpage` 클라이언트 추가, 백채널 로그아웃 엔드포인트 또는 5분 토큰 재검증 추가, `auth.ts` 7일 고정 세션을 유휴 7일/절대 30일 정책에 맞추는 수정이 필요함(실제 종단 동작 `[미확인]`).

#### 선택지 B. `axum` 자체 인증 — 나루가 Google OAuth 직접 연동 및 세션/SSO 발급
- **한 줄 정의**: Keycloak과 전용 DB를 제거하고, `axum` 백엔드가 Google OAuth 2.0/OIDC에 직접 붙어 사용자·세션(유휴 7일·절대 30일)·정지 상태를 단일 진실 원천(Naru PostgreSQL)으로 관리하며, Litpage에는 나루가 OIDC Provider(또는 서명된 SSO 토큰/세션 검증 엔드포인트) 역할을 제공하는 구조.
- **장점**:
  - `keycloak` + `keycloak-postgres` 컨테이너 제거로 단일 서버 프로세스·DB 운영 및 백업 대상이 단순화됨.
  - 회원 상태(즉시 가입, 정지, 탈퇴 30일 보관·복구)와 세션 수명(유휴 7일·절대 30일)이 Naru PostgreSQL 한 곳에서 원자적으로 처리됨(이중 동기화·`sub` 불일치 위험 제거).
  - 정지 시 리프레시 회전·Litpage SSO 진입 차단(05 §6.4)과 통합 로그아웃 전파를 Naru 백엔드가 직접 제어해 PV-017(≤ 5초) 예측 가능성이 높음.
- **단점**:
  - `axum`에 Google OAuth 클라이언트, 세션/토큰 발급·회전, 그리고 Litpage용 SSO(경량 OIDC Provider 또는 내부 검증 API/공유 세션)를 직접 구현·보안 검증해야 함.
  - 스파이크에서 인증 크레이트(`openidconnect`, `oauth2`, `jsonwebtoken`, `tower-sessions` 등)의 버전·취약점·유지보수 상태가 검증되지 않음(`[미확인]`, [06F-stack-feasibility.md](../../../docs/02-architecture/06F-stack-feasibility.md#L305-L318)).
  - 향후 다양한 프로토콜(SAML 등)의 외부 오픈소스를 붙일 때 표준 OIDC IdP 기능을 직접 확장해야 함.
- **단일 서버 운영 부담**: `keycloak` 및 `keycloak-postgres` 프로세스·전용 DB 없음. `naru-api`(Rust 바이너리) + 기존 Naru `postgres`만으로 동작(인증 계층 메모리 추가량은 `[미확인]`).
- **PV-017 충족 방법**: Naru 로그아웃 API가 Naru PostgreSQL의 세션을 즉시 무효화하고, 동시에 Litpage 내부 로그아웃/세션 무효화 API를 호출(내부 네트워크 동기/비동기 호출)하거나 Litpage가 매 요청/WebSocket 연결 시 Naru 세션 상태를 짧은 TTL(≤ 5분 또는 5초 이내 캐시/직접 조회)로 확인하게 하여 5초(p99) 내 전파를 직접 제어 가능.
- **PV-018 세션 상한 강제 위치**: Naru PostgreSQL 세션 테이블 한 곳에서 `last_active_at`(유휴 7일)과 `created_at`(절대 30일)을 단일 `Clock` 포트 기준으로 강제([06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L129-L133)).
- **정지 차단 구현 지점**(커밋 전 확정 기준): Naru `axum`의 로그인·리프레시 회전·Litpage SSO 진입 핸들러에서 Naru DB 회원 상태(`suspended`)를 즉시 조회해 거부. 살아있는 액세스 토큰(수명 ≤ 5분)은 만료까지 허용.
- **Litpage SSO 실현 가능성**:
  - **경로 B-1 (나루가 경량 OIDC Provider 제공)**: `oidc.ts`의 환경변수(`NC_OIDC_ISSUER` 등)와 PKCE/JWT 검증 구조를 거의 유지하고 IdP 대상만 Keycloak에서 `axum` 엔드포인트로 교체 가능. 단, `axum`에 OIDC Provider 엔드포인트(authorize, token, JWKS, logout) 구현 비용이 큼(`[미확인]`).
  - **경로 B-2 (인증 포트 교체 / 공유 세션 또는 내부 SSO)**: `oidc.ts`를 나루 전용 SSO 토큰 검증 또는 공통 쿠키/내부 API 검증으로 교체. 구현은 단순하나 `oidc.ts` 재사용 폭은 줄어듦.

#### 선택지 C. 하이브리드 (06F §9: 미검토, 선택지 발굴 필요)
- **현황**: [06F-stack-feasibility.md](../../../docs/02-architecture/06F-stack-feasibility.md#L291)와 [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L265) 모두 "미검토, 선택지 발굴 필요"로만 적혀 있으며 구체적 구성이 파일에 없습니다. (예: 구글 로그인/세션은 나루가 쥐고 오픈소스 앞단에만 인증 프록시(`oauth2-proxy` 등, 구문서 [open-source-integration.md](../../../docs/architecture/open-source-integration.md#L79)에 언급)를 두는 형태 등이 가능하나 **발굴 필요, 지금은 구체화하지 않음**.)

#### 선택지 D. 기타 호스트형 IdP (각주 — 검증 안 함)
- **Zitadel**: [idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L88)에 "가볍고 멀티 테넌트에 강하다고 알려져 있다. 검증하지 않았다"로만 기록되어 있어 본안에서 제외합니다(**검증 안 함**).
- **Authentik**: 로그인·복귀 시 HTML 로딩 화면이 노출되어 요건 R1(IdP 화면 비노출)을 충족하지 못해 이미 폐기되었습니다([idp-keycloak-architecture.md](../../../docs/architecture/idp-keycloak-architecture.md#L241-L248)).

---

### 5. Litpage 코드 재사용 선택지

> 전제: 현재 `services/litpage`에는 **나루 드라이브 자동 저장 기능이 전혀 구현되어 있지 않으며**, [services/litpage/NARU.md](../../../services/litpage/NARU.md#L41-L52) 기준 MCP PAT 교체, 외부 공유 정리, compose·realm 구성, 실제 종단 시험, 죽은 코드(MFA/패스키 UI) 정리 등이 남아 있습니다.

#### 안 1. 부분 재사용 — `services/litpage` Naru 수정분을 유지하고 인증/세션·드라이브 연동만 교체·보완
- **내용**: 기존 `services/litpage`의 비밀번호/데모/부트스트랩 제거(410 처리), `NaruBar.tsx`(`/auth/nav`), `jose` 기반 OIDC 골격(`oidc.ts`)을 그대로 두고, 선택한 IdP(A면 Keycloak realm+백채널 추가, B면 나루 인증 엔드포인트)에 맞게 `oidc.ts`와 `auth.ts`(7일 고정 → 유휴 7일/절대 30일 또는 나루 세션 연계)를 수정한 뒤 드라이브 저장 연동을 추가.
- **근거·장점**: 이미 한국어/영어 UI, Naru 상단 바 골격, 비밀번호 로그인 차단 등 NaruWorks용 1차 작업이 반영되어 있어 초기 공수가 적음([NARU.md](../../../services/litpage/NARU.md#L15-L25)).
- **위험**: `auth.ts`의 7일 고정 세션이 커밋 전 정지·만료 정책(유휴 7일·절대 30일)과 충돌할 수 있고, `NARU.md`의 "아직 안 한 일"(외부 공유 게스트 초대 경로 차단 등)과 죽은 코드가 남아 있어 점검이 필요함. 또한 컨테이너 환경에서 원본 테스트 21개가 이미 실패하는 상태임([NARU.md](../../../services/litpage/NARU.md#L52)).

#### 안 2. 비재사용 / 인증 재작성 — 업스트림(`931cd28`)에서 다시 연동하거나 인증 계층을 새로 작성
- **내용**: `services/litpage`의 Keycloak 특화 `oidc.ts`·`auth.ts` 수정분을 버리고, 업스트림 원본 또는 깔끔한 분기 위에서 나루 전용 인증 어댑터(예: 나루 내부 SSO/프록시 헤더 검증 또는 신규 OIDC)와 공통 헤더·푸터(FR-SHELL-001·002)를 새로 붙임.
- **근거·장점**: 선택지 B(`axum` 자체 인증)에서 Keycloak 전용 가정(`kc_idp_hint`, `realm_access.roles`, `id_token_hint`)을 억지로 에뮬레이션하지 않고 깔끔한 인증 경계를 설계할 수 있음.
- **위험**: 이미 작업된 `app.ts`·`handlers.ts`·`NaruBar.tsx`·테스트(`naru-oidc.test.ts`) 수정분을 다시 구현/이식해야 하므로 1차 출시 일정 부담이 커짐.

---

### 6. 저장 파일 형식 선택지

> 코드·기획 기준 사실:
> 1. 현재 Litpage의 권위 있는 저장소는 나루 드라이브 파일이 아니라 SQLite(`litpage.db`)의 `records` 테이블(블록·DB 스키마·코멘트·리치텍스트 JSON)입니다([db.ts](../../../services/litpage/apps/server/src/db.ts#L1-L30), [docs/architecture.md](../../../services/litpage/docs/architecture.md#L32-L44)).
> 2. 내보내기는 `ExportFormat = 'markdown' | 'html' | 'pdf'`(데이터베이스는 `.csv` + 행 페이지, PDF는 인쇄용 HTML)이며([render.ts](../../../services/litpage/apps/server/src/content/render.ts#L1-L21)), 가져오기는 `.md`, `.html`, `.docx`, `.csv`, `.xlsx`, `.pdf`, ZIP 등을 지원합니다([import.ts](../../../services/litpage/apps/server/src/api/modules/import.ts#L10-L39)).
> 3. 기획은 **"형식을 지원하면 같은 파일로 이어서 작업"**(오픈소스 교체 대비, DEC-026, [README.md](../../../README.md#L43))을 지향하며 형식 결정은 설계로 이관했습니다(FR-OSS-001·003). *(PDF는 보기/인쇄용 출력이므로 정규 저장 형식으로 부적합합니다.)*

#### 형식 1. Markdown(및 첨부파일·DB CSV) 내보내기 기반 (단일 `.md` 또는 번들 `.zip`)
- **설명**: Litpage의 기존 `exportTree` 렌더러(`format: 'markdown'`)를 활용해 문서 본문은 `.md`, 데이터베이스는 `.csv`, 하위 페이지·첨부 이미지는 폴더/ZIP으로 묶어 사용자의 드라이브 폴더(`/litpage/...`)에 자동 저장.
- **장점**:
  - 범용 이식성이 가장 높아, 1차에 다른 오픈소스로 교체하거나 사용자가 드라이브에서 직접 내려받아 다른 편집기로 열어 이어서 작업하기 좋음(DEC-026 취지 부합).
  - Litpage에 이미 Markdown 내보내기(`render.ts`)와 가져오기(`import.ts`) 코드가 존재함.
- **단점·미확인**: 블록 ID, 리치텍스트 속성, DB 수식·관계형·뷰 설정, 댓글 등 Litpage 고유 메타데이터가 Markdown/CSV 왕복(저장 후 다시 Litpage로 열어 편집) 시 무손실로 복원되는지는 **`[미확인]`**입니다.

#### 형식 2. 네이티브 스냅샷 (Litpage 레코드 JSON 번들 또는 SQLite 파생 스냅샷)
- **설명**: SQLite `records` 테이블의 페이지·블록·컬렉션 JSON 레코드 그래프(및 첨부파일)를 그대로 직렬화한 파일(예: `.litpage.json` 또는 전용 스냅샷)을 드라이브에 저장.
- **장점**:
  - Litpage에서 다시 열 때(FR-DRV-005) 블록·DB 수식·뷰·메타데이터의 무손실 왕복 복원 구현이 이론상 명확함.
- **단점**:
  - 이식성이 낮아 다른 문서 오픈소스로 교체 시 바로 열어 이어 작업하기 어렵고(DEC-026 취지와 약화), 드라이브에서 사람이 바로 읽거나 미리보기(FR-DRV-008)하기 어려움.
  - 현재 코드에 전용 레코드 스냅샷 내보내기/가져오기 핸들러가 구현되어 있지는 않음.

#### 형식 3. 하이브리드 (정규 형식 + 부가 형식)
- **설명**: 사용자가 드라이브에서 보고 다른 도구로도 이어 쓸 수 있는 **Markdown(+CSV/첨부)**을 기본 가시 파일로 저장하고, Litpage 무손실 재편집이 필요한 경우 내부 복원용 **네이티브 레코드 메타/스냅샷**을 병행(또는 드라이브 메타데이터와 연결)하는 방식.
- **장점**: 이식성(DEC-026)과 Litpage 내 무손실 재편집(FR-DRV-005) 두 요구를 모두 겨냥할 수 있음.
- **단점**: 저장 공간·동기화 복잡도(두 파일 간 버전 불일치 시 어느 쪽을 정본으로 볼지)가 증가하며, 실제 동기화·충돌 해결 방식은 `[미확인]`입니다.

---

### 7. 추천(미결정)과 이유

> 아래는 선택을 돕기 위한 잠정 추천이며 결정이 아닙니다.

1. **IdP: 선택지 B (`axum` 자체 인증)**
   - **이유**: 1차 규모가 지인 100명 이내·동시 20명·단일 서버(NFR-PERF-001·004, AS-A4)이고, 2026-11-19 확정된 **유휴 7일·절대 30일 세션**과 **정지 시 리프레시 회전·Litpage SSO 진입 차단**, **5초 이내 통합 로그아웃 전파(PV-017)**를 Keycloak + 전용 Postgres + Naru + Litpage 3~4곳에 걸쳐 동기화하는 것보다 Naru PostgreSQL 한 곳에서 강제하는 편이 단순하고 장애·상태 불일치 지점이 적습니다.
   - **반대 리스크·`[미확인]`**: Rust 인증 크레이트 안정성·취약점(`U-14`, `[미확인]`)과 `axum` 내 SSO/OIDC 발급 코드 직접 구현·보안 검증 비용이 발생합니다.
2. **Litpage 코드 재사용: 부분 재사용 (안 1)**
   - **이유**: `services/litpage`에 이미 적용된 비밀번호 로그인 비활성화, `NaruBar.tsx` 틀, ko/en UI를 버리고 처음부터 다시 고치는 비용이 큽니다. `oidc.ts`·`auth.ts`의 인증 대상/세션 수명 부분만 선택한 IdP에 맞춰 교체하는 것이 효율적입니다.
   - **반대 리스크·`[미확인]`**: `NARU.md`의 남은 보안/정리 항목(외부 공유 게스트 초대, 죽은 코드, 원본 실패 테스트 21개) 점검이 필요합니다.
3. **저장 파일 형식: 형식 1 (Markdown + 첨부/CSV 기반) 출발, 왕복 손실 확인 후 필요 시 형식 3(하이브리드) 보완**
   - **이유**: DEC-026("오픈소스 교체를 고려한 규칙")과 기존 `render.ts`/`import.ts` 구현 자산을 가장 잘 활용합니다.
   - **반대 리스크·`[미확인]`**: Litpage DB 수식·블록 속성 등의 왕복(다시 열어 편집) 손실 허용 범위가 `[미확인]`이며, 손실이 허용 불가라면 형식 2 또는 형식 3이 필요합니다.

---

### 8. 호배님께 드릴 짧은 질문

1. **인증 서버(IdP) 방향**: 운영 단순화와 상태 일관성을 위해 **Keycloak을 내리고 `axum`에서 Google 로그인·세션을 직접 구현(안 B)**할까요, 아니면 향후 다른 오픈소스 확장성을 위해 **기존 Keycloak을 유지(안 A)**할까요?
2. **Litpage 수정 코드 처리**: 기존 `services/litpage`의 수정분(상단 바, 비밀번호 로그인 제거 등)을 **그대로 살려 인증 연결 부분만 고쳐 쓸까요(안 1)**, 아니면 **새로 깔끔하게 연동할까요(안 2)**?
3. **드라이브 저장 파일 형식과 재편집**: Litpage 문서를 드라이브에 저장할 때 **다른 앱에서도 열 수 있는 Markdown/CSV 형식(형식 1)**을 우선할까요, 아니면 **Litpage의 표·수식·속성이 100% 그대로 유지되는 전용 스냅샷(형식 2)**이나 **둘 다 저장(형식 3)**을 원하시나요?
4. **Litpage 문서 왕복 편집 허용 수준**: 만약 Markdown으로 저장했다가 다시 Litpage로 열 때 일부 서식이나 데이터베이스 속성이 단순화되더라도 괜찮으신가요, 아니면 **완벽한 무손실 재편집**이 필수인가요?

---

### 9. 검토하지 못한 것
- `.env` 및 `.env.*` 비밀 파일 내용 (보안 규칙상 미열람).
- 운영 환경(`start` 모드)에서의 Keycloak 실제 메모리 사용량 및 컨테이너 종단 부하(문서상 미측정).
- Rust 인증 관련 크레이트(`openidconnect`, `oauth2`, `jsonwebtoken`, `tower-sessions`)의 최신 버전, 유지보수 상태, 취약점 이력(`06F` U-01·U-14).
- Litpage `render.ts`(내보내기)와 `import.ts`(가져오기) 간 실제 왕복(round-trip) 데이터 손실 범위 테스트.
- Litpage의 백채널 로그아웃 구현 시 5초(p99) 전파(PV-017) 달성 여부 실측.
- `services/litpage`를 제외한 `backend/`(Spring) 및 `frontend/`(Next.js) 내부 상세 소스(신규 Rust 전환 및 디자인 시안 대기 범위).
