# 10 관측·CI 설계

| 항목 | 값 |
| --- | --- |
| 버전 | v0.2 |
| 일시 | 2026-11-26 (KST) |
| 상태 | 초안, Gemini 검토 대기 |
| 기획 기준선 | develop `2f1db92` (PR #99) |
| 작업 브랜치 | `feature/NARU-94-architecture`, HEAD `24b5849` |
| 관측·구조 입력 | [04 기술 NFR v0.3](04-NFR-technical.md), [05 아키텍처 v0.4](05-architecture.md), [06 크레이트 구조 v0.4](06-crate-layout.md), [06F 스택 타당성](06F-stack-feasibility.md), [ADR 0003](../decisions/0003-backend-stack.md) |
| 계약 입력 | [07 API v0.4](07-api/07-api.md), [OpenAPI v0.4](07-api/openapi.yaml), [08 DB v0.2](08-db/08-db-schema.md), [08 문서용 SQL](08-db/migrations/0001_init.sql), [09 인증 v0.2](09-auth.md), [ADR 0004](../decisions/0004-auth-idp-litpage.md) |

설계서 23장의 `10-observability-ops.md` 정의에 대응하는 산출물은 `10-observability-ci.md`이며, 로그·트레이싱·지표, CI(`cargo fmt`·`clippy`·`test`), 컨테이너 빌드를 다룬다.

23장의 완료 기준인 ‘CI 게이트 명령 확정’에 사용할 명령을 §7에 제안한다. **[기획]**은 `2f1db92`의 요구·결정, **[제안]**은 10의 검토안, **[제안값 PV-…]**은 04의 기술 수치화 제안이다. [기획 NFR](../01-planning/nfr/NFR.md), [결정 로그](../01-planning/02-decision-log/decision-log.md), [열린 질문](../01-planning/02-decision-log/open-questions.md)

## 변경 이력

| 버전 | 일시 | 변경 |
| --- | --- | --- |
| v0.1 | 2026-11-26 (KST) | 관측·CI 설계 초안. |
| v0.2 | 2026-11-26 (KST) | SSO B-1 결정 반영, B-2 대기 문구 제거. |

## 1. 기존 CI 현황

| 워크플로 | 트리거·조건 | 잡·명령 | 선언 권한 |
| --- | --- | --- | --- |
| `PR CI` | `develop`·`main` 대상 `pull_request`와 두 브랜치의 `push`. 워크플로·ref별 동시 실행 그룹에서 진행 중인 이전 실행을 취소한다. | `backend-test` (`Backend Test`)는 `ubuntu-latest`의 `backend/`에서 Temurin Java 21과 Gradle 캐시를 사용해 `./gradlew clean test`를 실행한다. `frontend-quality` (`Frontend Quality`)는 `ubuntu-latest`의 `frontend/`에서 Node 22와 `frontend/package-lock.json` 기반 npm 캐시를 사용해 `npm ci` → `npm run lint` → `npm run build`를 실행한다. | `contents: read` |
| `Close Linked Issues` | `pull_request`의 `closed` 이벤트. 실제로 머지됐고 대상 브랜치가 `develop`인 경우에만 잡을 실행한다. | `close-linked-issues` (`Close Linked Issues`)는 `ubuntu-latest`에서 `actions/github-script@v8`을 실행한다. PR 본문에서 `close`·`fix`·`resolve` 계열 키워드 뒤 공백과 `#번호`를 대소문자 구분 없이 찾고 중복을 제거한다. 같은 저장소의 이슈를 조회해 열린 이슈를 닫고, 개별 처리 실패는 경고로 남긴다. | `issues: write`, `pull-requests: read` |

이 표는 현재 체크아웃의 Java·Node 워크플로 기록이다. Rust 재작성의 목표 게이트는 §7의 제안이다. PR 템플릿은 현행 Gradle 시험과 프런트 lint·build를, 릴리즈 템플릿은 `Backend Test`·`Frontend Quality`와 Docker Compose·운영 도메인 확인을 적고 있다. 기능 이슈 템플릿은 작업 방식·영역·검증 시나리오를 받는다. [PR CI](../../.github/workflows/pr-ci.yml), [이슈 자동 종료](../../.github/workflows/close-linked-issues.yml), [PR 템플릿](../../.github/PULL_REQUEST_TEMPLATE.md), [릴리즈 템플릿](../../.github/ISSUE_TEMPLATE/release.yml), [기능 이슈 템플릿](../../.github/ISSUE_TEMPLATE/feature.yml)

## 2. 구조화 로그

ADR 0003의 `tracing`·`tower-http`를 사용한다. **[제안]** `naru-http`에서 `TraceLayer`로 요청 스팬과 완료 이벤트를 만들고, `naru-api`·`naru-worker`는 공통 필드 규칙에 따라 JSON 로그를 표준 출력으로 보낸다. 앱·프록시·수집기에서 허용 목록을 적용한다. 아래 필드명과 출력 형식은 제안이다. [05 §4·§7](05-architecture.md), [06 §3·§6](06-crate-layout.md), [06F §4.6·RK-010](06F-stack-feasibility.md), [ADR 0003](../decisions/0003-backend-stack.md)

| 필드 후보 | 기록 기준 |
| --- | --- |
| `timestamp`, `level`, `target`, `service`, `event` | UTC 시각, 수준, 모듈 또는 기록 대상, API·워커 등 서비스 구분, 정해진 이벤트 이름 |
| `request_id`, `trace_id`, `span_id` | 요청별 서버 발급 상관 ID와 추적 문맥. 추적 ID·스팬 ID는 문맥이 있는 경우에만 기록 |
| `method`, `route`, `status`, `duration_ms`, `error_code` | 메서드, 매칭된 라우트 템플릿, 응답 상태, 경과 시간, 허용된 오류 코드. 타임아웃처럼 응답이 없으면 상태 필드를 생략하고 결과 분류를 남김 |
| `member_id` | 인증된 회원의 내부 식별자. 기본 접근 로그에서는 생략하고 조사에 필요한 제한된 애플리케이션 이벤트에서만 사용을 검토. 가명 식별자로 취급하며 수집 범위는 [미확인] |

**[제안값 PV-016]** 토큰·시크릿·이메일 원문은 기록 전에 제거하거나 마스킹한다. **[제안]** 요청·응답 본문, 원본 URL·쿼리 문자열, `Authorization`·쿠키·CSRF 헤더 값, OAuth 콜백의 `code`·`state`, 공개 공유 링크 키, SQL과 공급자 오류 원문은 기록 대상에서 제외한다. 예를 들어 `/public/links/{linkKey}`는 템플릿만 적는다. 라우트 매칭 전에 실패하면 고정값으로 기록한다. 04의 PV-035에 따라 스테이징 표본 1만 줄에서 토큰·시크릿·원문 이메일 패턴 0건을 확인하고, 콜백·공개 링크·실패 로그도 시험에 포함한다. [04 §4.7·§6](04-NFR-technical.md), [06 §6](06-crate-layout.md), [07 OpenAPI](07-api/openapi.yaml), [09 인증](09-auth.md)

**[기획]** 운영 로그는 30일 보관 후 만료한다(NFR-OPS-002, DEC-044). DEC-085의 성공 지표 집계는 별도 보관 대상으로 두어 로그 만료의 영향을 받지 않게 한다. **[제안]** 수집기와 저장소의 버퍼·복제본까지 운영 로그 만료 범위에 넣고, 별도 저장소 또는 보존 정책으로 PV-016의 비식별 일 집계를 저장한다. 예를 들어 PRD의 회원 탈퇴 완료율은 일별 시도·완료 건수로 집계하는 안을 검토한다. 집계 항목·보관 기간·회원 식별 정보 포함 여부는 [미확인]이다. AC-NFR-OPS-002-01·02는 표식 로그를 만료시킨 후 별도 집계가 남는지 확인한다. [04 §4.7](04-NFR-technical.md), [PRD §6](../01-planning/prd/PRD.md), [기획 AC](../01-planning/acceptance-criteria/AC.md), [추적 매트릭스](../01-planning/traceability/matrix.csv)

## 3. 지표와 추적

| 추적 방식 | 설계 판단 |
| --- | --- |
| `tracing` + `tracing-subscriber` + `tower-http` | **[제안]** 1차는 요청·작업 스팬과 상관 ID로 장애를 조사한다. 06F §4.6의 1순위로, 별도 분산 트레이스 수집기를 운영하는 비용을 줄인다. |
| OpenTelemetry 연동 | API·워커·Litpage를 오가는 지연을 구간별로 조사할 필요가 커지면 검토한다. 06F §4.6은 분산 트레이스의 장점과 수집기 운영 부담을 함께 적었다. 연동 범위, 크레이트 호환성, 샘플링·수집기·보관 방식은 [미확인]이다. |

**[제안]** 공개 경계에서 요청별 상관 ID를 발급해 응답과 내부 요청에 사용하고, 내부 서비스·비동기 작업에는 필요한 상관 문맥만 전달한다. 신뢰하는 내부 HTTP 구간의 분산 추적을 도입할 때 W3C `traceparent`를 전파한다. 공개 요청에서는 자체 추적 문맥을 시작하며 외부 공급자 호출과 공개 응답으로 내부 추적 문맥을 전달하지 않는다. Litpage의 계측 및 전파 범위는 [미확인]이다. [ADR 0003](../decisions/0003-backend-stack.md), [06F §4.6](06F-stack-feasibility.md), [W3C Trace Context](https://www.w3.org/TR/trace-context/)

**[제안]** 요청 수와 지연 분포, HTTP 5xx와 호출자·프록시가 관측한 타임아웃, 가입자 수, 최근 요청한 활성 세션 수, 서비스 전체 저장 사용량, 외부 가용성, 백업·정리 작업 결과를 수집한다. 요청 지표는 서비스·라우트 템플릿·상태 분류를 차원으로 쓴다. 회원·세션·요청·추적 ID는 지표 차원에서 제외한다. 활성 세션은 만료·폐기 상태를 고려해 현재 유효한 세션의 최근 요청을 중복 없이 세는 안으로, 08의 `sessions.last_activity_at`을 활용할 수 있다. 내부 집계와 외부 프로브는 독립적으로 관측한다. 저장 용량은 06의 저장소 관측 경계와 맞추고, 수집 실패는 사용량 0과 구분한다. 구체적인 활동 기록·수집·집계 방식은 [미확인]이다. [05 §7·§8](05-architecture.md), [06 §5](06-crate-layout.md), [08 세션](08-db/08-db-schema.md#sessions--나루-로그인-세션), [09 인증](09-auth.md)

## 4. 경보와 NFR

| 근거 | 기획 기준 또는 04 제안값 | 관측·경보 제안과 미확인 |
| --- | --- | --- |
| NFR-OPS-004, DEC-105·010, AC-NFR-OPS-004-01 | **[기획]** 서비스 전체 저장 용량이 기준을 넘으면 운영 경보. 경보로 업로드를 차단하거나 회원별 총용량 한도를 두지 않는다. | 전체 사용량을 운영 경계에서 집계한다. 설정된 임계값 초과와 이후 정상 업로드를 함께 시험한다. 용량 산정 범위, 기준 수치·수신자·방법은 Q-092 [미확인]. |
| NFR-PERF-001·004, DEC-036·DEC-088, AC-NFR-PERF-004-03 | **[기획]** 예상 사용자 100명 이내. 가입자 80명·100명 도달 시 운영 경보를 내며 가입을 계속 허용한다. | 가입 확정 후 집계가 두 기준에 도달할 때 통지한다. 79→80과 99→100, 100명 초과 가입을 시험한다. 집계의 탈퇴 회원 취급·재알림 조건, 수신자·방법 [미확인]. |
| NFR-PERF-004, DEC-049·088, AC-NFR-PERF-004-01·02 | **[기획]** 최근 60초에 요청한 활성 세션 20개에서 5xx·타임아웃 오류율 ≤0.1%. | 스테이징 부하에서 활성 세션 수와 요청 결과를 함께 본다. 운영 경보는 5xx와 타임아웃을 중복 집계하지 않도록 관측 범위를 정한 뒤 검토한다. 분모·집계 창·최소 표본, 알림 조건·수신자·방법 [미확인]. |
| NFR-PERF-003, DEC-041·087, AC-NFR-PERF-003-01·02 | **[기획]** 화면 이동 p95 ≤2초, 썸네일 표시 p95 ≤3초. 파일 전송·최초 썸네일 생성·Google 로그인 제외, Litpage 로딩 포함. **[제안값 PV-008]** 목록·메타데이터 API p95 ≤300 ms. | 브라우저 측정으로 화면 목표를 확인하고 API 지연 분포는 병목 진단에 쓴다. 운영 경보의 표본·집계 창·수신자·방법 [미확인]. |
| NFR-AVAIL-001, DEC-042·089, AC-NFR-AVAIL-001-01·02 | **[기획]** 월 99%, 출시 후 한 달 관찰. 사전 공지 점검과 Google·Cloudflare 등 외부 장애 제외. **[제안값 PV-012]** 1분 간격 외부 프로브와 중단 경보. | 외부에서 실제 도달 여부를 기록하고 미공지 점검·자체 장애를 중단으로 센다. 관측 기록에 제외 사유를 남긴다. 공지 기준·외부 장애 귀책 판정·경보 조건·수신자·방법·목표 미달 조치는 [미확인]. 월 가용률은 출시 전 CI 게이트와 별개다. |
| NFR-OPS-001, DEC-046·083·091, AC-NFR-OPS-001-01~03 | **[기획]** 회원 정보·드라이브 파일만 매일 백업하고 30일 후 자동 만료. 공유·링크·설정 제외. 복원 후 이미 처리된 탈퇴·휴지통 삭제 재적용. | 최근 백업 완료 시각, 실패·만료 처리, 복원 및 삭제 재적용 결과를 기록한다. 백업 누락·복원 실패 경보와 통지 방법, 복원 주체·절차는 [미확인]. |

근거와 수락 기준은 [04 §3·§4.6·§4.7](04-NFR-technical.md), [기획 NFR](../01-planning/nfr/NFR.md), [결정 로그](../01-planning/02-decision-log/decision-log.md), [기획 AC](../01-planning/acceptance-criteria/AC.md), [추적 매트릭스](../01-planning/traceability/matrix.csv)에 따른다.

## 5. 헬스체크

07 OpenAPI v0.4의 `paths`에는 헬스체크 경로가 없다. 아래는 **[제안]** 운영 전용 경로이며 채택 후 07 개정에서 `/api/v1` 외부의 운영 경계와 프로브 계약을 반영한다. [07 OpenAPI](07-api/openapi.yaml), [05 §4·§8](05-architecture.md)

| 경로 후보 | 검사 |
| --- | --- |
| `GET /livez` | API 프로세스가 요청에 응답할 수 있으면 `200`. DB·객체 저장소 등 외부 의존성을 검사하지 않아 의존성 장애가 재시작으로 이어지지 않게 한다. |
| `GET /readyz` | 초기화 완료와 PostgreSQL에 대한 짧은 읽기 검사가 성공하면 `200`, 초기화 중·종료 처리 중·필수 검사 실패 시 `503`. 객체 저장소는 파일 기능을 위한 읽기 전용 검사 후보이며, 전체 API의 준비 상태를 내릴지 파일 기능 가용성을 별도로 표시할지는 저장소 ADR·배포 구조에 따라 정한다 [미확인]. |

**[제안]** 프로브에는 검사별 타임아웃을 두고 응답에 접속 정보·오류 원문을 노출하지 않는다. 배포 환경의 내부 프로브와 NFR-AVAIL-001의 사용자 경로 외부 프로브를 따로 운영한다. 객체 저장소·Google·Litpage 등 의존성 관측은 사용자 경로와 실패 원인을 대조하는 데 쓴다. 공개 범위·검사 주기·워커 프로브는 [미확인]이다. [04 §4.6](04-NFR-technical.md), [06 §3·§5](06-crate-layout.md)

## 6. 관리자 감사와 탈퇴·삭제 기록

- **[기획]** 관리자의 회원 정지·해제와 오픈소스 숨김·노출을 각각 기록한다(NFR-OPS-003, DEC-104, FR-ADM-002·003, BR-017). 정지 확인을 취소했을 때는 성공 기록이 없어야 한다. **[제안]** 실제로 확정된 상태 변경을 응용 계층에서 기록하고, 상태 변경과 기록 전달 사이의 누락 및 재시도 중복을 검증한다. 실패·변경 없음은 성공과 구분하고 감사 포함 여부는 Q-091에 둔다. [05 §7·§8](05-architecture.md), [07 OpenAPI](07-api/openapi.yaml), [FRD](../01-planning/frd/FRD.md), [BR](../01-planning/business-rules/BR.md), [AC-FR-ADM-002-04·003-04](../01-planning/acceptance-criteria/AC.md)
- **[제안]** 최소 필드 윤곽은 관리자 내부 식별자, 확정 시각, 동작 종류, 대상 유형·내부 식별자, 처리 결과, 요청 상관 ID다. 자유 입력·프로필 원문·자격은 담지 않는다. 08은 Q-091 확인 뒤 감사 저장 경계와 컬럼을 설계하도록 뒀고, 08의 SQL 초안에는 관리자 감사 테이블이 없다. 채택 시 08을 개정한다. 감사 대상의 확대, 항목, 보관 기간, 운영 로그 30일 적용 여부와 법적 적정성은 Q-081·Q-091 [미확인]이며 정식 배포 전 확인한다. [08 보존·삭제 규칙](08-db/08-db-schema.md), [08 문서용 SQL](08-db/migrations/0001_init.sql), [기획 열린 질문](../01-planning/02-decision-log/open-questions.md)
- **[기획·08 설계]** 회원 탈퇴·재가입 복구와 탈퇴 보관·휴지통 만료 삭제는 FR-AUTH-003·004, FR-DRV-004, BR-006·007과 NFR-OPS-001에 근거한다. 08의 `deletion_events`는 탈퇴·복구·최종 삭제를 기록해 백업 복원 시 삭제 상태를 재적용하는 원장 제안이다. **[제안]** 정리·복원 작업의 완료·실패를 운영 지표로 남기고, 탈퇴·삭제와 카테고리·서비스 배정 변경(FR-ADM-004, BR-023)을 감사에 포함할지는 Q-091에서 검토한다. [08 삭제 원장](08-db/08-db-schema.md), [FRD](../01-planning/frd/FRD.md), [BR](../01-planning/business-rules/BR.md), [추적 매트릭스](../01-planning/traceability/matrix.csv)
- **[제안]** 정지 확정 시각과 재로그인·갱신·Litpage 신규 진입 차단 결과를 대조할 수 있도록 시험에서 상관 ID와 결과 코드를 남긴다. 정지만으로 열린 세션을 즉시 종료하지 않는 DEC-098을 판정에 반영한다. PV-018의 반영 ≤5초는 새 로그인 차단 시험의 제안값이고, 이미 열린 세션의 갱신 차단까지 최대 시간은 Q-087 [미확인]이다. [04 §4.4](04-NFR-technical.md), [09 인증](09-auth.md), [ADR 0004](../decisions/0004-auth-idp-litpage.md)

## 7. CI 파이프라인 제안

Rust 워크스페이스와 실제 구현 마이그레이션이 준비된 시점에 아래 잡을 도입한다. `cargo` 명령은 워크스페이스 루트에서 실행한다. 도입 시 도구 체인과 `Cargo.lock`을 고정해 개발 환경과 CI의 차이를 줄인다. 최종 도구 버전·기능 플래그·필수 검사 이름은 [미확인]이다. [06 §3·§8](06-crate-layout.md), [06F RK-002·008](06F-stack-feasibility.md), [ADR 0003](../decisions/0003-backend-stack.md)

| 단계 | 게이트 명령·판정 제안 |
| --- | --- |
| Rust 포맷 | `cargo fmt --all -- --check`. 워크스페이스 포맷 차이가 있으면 실패로 처리한다. [rustfmt](https://github.com/rust-lang/rustfmt) |
| Rust 정적 검사 | `cargo clippy --workspace --all-targets -- -D warnings`. 코드와 시험 타깃의 경고를 PR에서 드러내도록 도구 체인을 고정한 뒤 실패 조건으로 삼는다. 도구 체인 갱신 때 추가된 린트는 갱신 PR에서 검토한다. [Clippy](https://doc.rust-lang.org/clippy/usage.html) |
| PostgreSQL 마이그레이션 검사 | CI에서 `DATABASE_URL`을 임시 PostgreSQL로 지정하고 `sqlx migrate run --source crates/naru-adapters/migrations`을 실행한다. 06의 경로 제안을 기준으로 빈 DB에 실제 구현 마이그레이션이 순서대로 적용되는지 검증하고, 이전 릴리즈가 생기면 이전 스키마에서의 적용 경로도 시험한다. 08의 SQL은 문서용 초안이다. [06 §3](06-crate-layout.md), [08 문서용 SQL](08-db/migrations/0001_init.sql), [SQLx CLI](https://github.com/transact-rs/sqlx/blob/v0.8.6/sqlx-cli/README.md#create-and-run-migrations) |
| Rust 시험 | `cargo test --workspace`. DB가 필요한 시험은 격리한 PostgreSQL에서 실제 `query_as` 실행과 마이그레이션 적용을 검증한다. `#[sqlx::test]` 활용은 ADR 0003의 후속 검증 안을 따른다. [06 §8](06-crate-layout.md), [ADR 0003](../decisions/0003-backend-stack.md), [Cargo](https://doc.rust-lang.org/cargo/commands/cargo-test.html) |
| OpenAPI 린트 | Redocly CLI 후보 명령 `redocly lint --extends=spec docs/02-architecture/07-api/openapi.yaml`을 저장소 루트에서 실행해 OpenAPI 3.1 구조와 참조를 검사한다. 이후 utoipa 생성 명세가 준비되면 경로·응답·인증 스킴의 계약 차이 검사도 붙이는 안을 검토한다. CLI 선택·버전·추가 규칙은 [미확인]. [07 OpenAPI](07-api/openapi.yaml), [Redocly CLI](https://redocly.com/docs/cli/commands/lint) |
| 프런트엔드 | 린트·빌드·시험 단계의 자리만 두고 프런트 스택 결정 후 확정한다. |
| 컨테이너 빌드 | 선행 검사를 통과한 뒤 Rust 릴리즈 바이너리 빌드 단계와 실행 이미지 단계를 나눠 API 이미지와 필요한 경우 워커 이미지의 빌드 성공을 확인한다. PR 단계는 이미지 빌드 검증까지만 수행한다. Dockerfile 경로, 이미지 레지스트리·대상 아키텍처·배포 호스트는 [미확인]. [06 §3](06-crate-layout.md), [Docker 다단계 빌드](https://docs.docker.com/build/building/multi-stage/) |

`query!`는 호배님 결정으로 당분간 제외되어 `.sqlx` 메타데이터 검사를 현 제안의 필수 게이트에 넣지 않는다. 재도입이 승인되면 마이그레이션을 적용한 검증 DB에서 `cargo sqlx prepare --workspace`로 `.sqlx`를 생성·갱신한다. CI는 같은 스키마를 적용한 임시 DB에 연결해 `cargo sqlx prepare --check --workspace`로 메타데이터 차이를 검증하고, 별도 오프라인 빌드는 `SQLX_OFFLINE=true`로 메타데이터를 사용한다. 메타데이터 검사는 마이그레이션 적용과 런타임 질의 시험에 추가하는 단계다. [ADR 0003](../decisions/0003-backend-stack.md), [06F RK-008](06F-stack-feasibility.md), [SQLx CLI](https://github.com/transact-rs/sqlx/blob/v0.8.6/sqlx-cli/README.md#enable-building-in-offline-mode-with-query)

전환 시 현행 Java·Node 검사를 유지한 상태에서 준비된 Rust·OpenAPI·이미지 검사를 별도 상태 검사로 확인한다. 각 결과가 PR에서 안정적으로 보고되면 승인된 전환 PR에서 Java 백엔드 검사를 Rust 검사로 교체하고, 프런트 검사 전환은 스택이 정해진 뒤 진행한다. 필수 상태 검사 변경은 새 검사 이름과 실행 여부를 확인한 뒤 적용한다. 이슈 자동 종료는 소스 검증과 독립된 워크플로로 운영한다. [현행 PR CI](../../.github/workflows/pr-ci.yml), [현행 이슈 자동 종료](../../.github/workflows/close-linked-issues.yml)

## 8. 브랜치 규칙 제안

| 브랜치 | 적용 제안 |
| --- | --- |
| `main` | 직접 수정·푸시 금지. `develop`에서 릴리즈 PR을 열고 필수 CI가 성공한 뒤 반영한다. 삭제·강제 푸시 금지를 유지하는 방향이다. |
| `develop` | 기능 브랜치 PR을 통해 반영하고 직접 푸시·삭제·강제 푸시를 금지한다. 전환 후 승인된 Rust 포맷·정적 검사·DB 마이그레이션·워크스페이스 시험·OpenAPI·이미지 빌드 상태 검사를 필수로 제안한다. 프런트 검사는 스택 결정과 잡 준비 이후에 검토한다. |

저장소 협업 문서는 두 브랜치의 직접 푸시 금지와 `feature` → `develop` → `main` PR 경로를 명시한다. 같은 문서에는 2026-09-16에 `main` Ruleset을 적용했고 `Backend Test`·`Frontend Quality`를 필수로 설정했다고 기록돼 있다. `develop` 보호는 문서상 후속 항목이다. 설계서 4장·29장 원문과의 직접 대조 및 GitHub의 현재 적용 상태는 [미확인]이다. **필요한 권한**은 실제 Ruleset·필수 상태 검사 적용 또는 변경에 대한 호배님 승인과 해당 저장소 설정 권한이다. [GitHub 협업 워크플로](../development/github-workflow.md), [GitHub 작업 런북](../development/git-github-session-runbook.md)

## 9. 시크릿 보관 위치

| 대상 | 보관 위치 |
| --- | --- |
| CO-01·CO-02 도메인·Cloudflare 설정 | Cloudflare 대시보드(DEC-082) |
| CO-03 Google OAuth 설정 | Google Cloud Console(DEC-082) |
| CI 전용 시크릿 | 필요한 경우 GitHub Actions의 저장소 또는 환경 Secrets를 보관 위치로 제안한다. 제안한 PR 게이트는 임시 시험 자격만 사용하고 운영 시크릿을 참조하지 않는다. |
| 운영 주입용 시크릿 | DB·객체 저장소·CSRF·OAuth 등 런타임 주입의 실제 보관 위치 [미확인]. |

근거는 [기획 CO-01~03](../01-planning/carry-over/README.md), [06 §7](06-crate-layout.md), [09 인증](09-auth.md), [GitHub 협업 워크플로](../development/github-workflow.md)에 따른다.

## 10. 남은 확인 사항

| 항목 | 확인할 내용 |
| --- | --- |
| RB-017 [미확인] | CO-02 Cloudflare 프록시 경로·본문 한도와 1 GiB 단일 업로드의 양립 여부. |
| GAP-016·018·025 [미확인] | 기획 기본 보안선, 지원 브라우저의 ‘최신’ 정의와 iOS 타 브라우저 취급, Litpage 자동 저장 지연·재시도·실패 정의·1 GiB 적용과 무손실 패키징. |
| Q-081·Q-091 [미확인] | 사업자·운영자 정보 표시의 법적 요건, 감사 항목·보관 기간·운영 로그 30일 적용 여부, 운영 로그 30일 및 감사 기록의 법적 적정성. |
| Q-085·Q-087 [미확인] | 휴지통·탈퇴 보관 달력 날짜 30일의 시간대·경계·시작일 산입, 열린 세션의 갱신 주기와 정지 후 차단까지의 최대 시간. |
| Q-092 [미확인] | 전체 저장 용량 경보 기준 수치·수신자·방법. |
| DM-002/004/006/007/009/010/011 [미확인] | 07·08의 디자인 대응 보류 항목. |
| SSO | 호배님이 2026-11-26 21:45 KST에 B-1(나루 OIDC OP·Litpage 새 RP)을 채택하고 B-2를 기각했다. 인증 라이브러리 선정 스파이크, Litpage RP 재부착 검증, B-1 로그아웃 백채널 전파·웹소켓 폐기 및 실측은 [미확인]이다. [09 §4·5·9·11](09-auth.md), [13 §3.4·6](13-cutover.md) |
| CO-03 [미확인] | 기존 OAuth 클라이언트 재사용·재발급 및 redirect URI 재사용·추가 등록 여부. |
| 운영 [미확인] | 배포 호스트·이미지 레지스트리, 런타임 시크릿 위치, 관측 저장소, 성공 지표 집계 항목·보관 기간, 분산 추적·헬스체크 적용 범위, §4의 미확인 경보 설정. |
| CI·브랜치 [미확인] | 설계서 4·23·29장 원문, 실제 Ruleset 상태, 최종 게이트 및 워크스페이스·임시 DB에서의 실행 결과. **필요한 권한**은 후속 구현 시 도구 설치·시험 PostgreSQL 실행 승인과 §8의 저장소 설정 권한이다. |

근거는 [04 기술 NFR](04-NFR-technical.md), [07 API](07-api/07-api.md), [08 DB](08-db/08-db-schema.md), [09 인증](09-auth.md), [기획 열린 질문](../01-planning/02-decision-log/open-questions.md)에 따른다. 로컬 문서·OpenAPI 린터는 도구 없음으로 실행을 생략했다.
