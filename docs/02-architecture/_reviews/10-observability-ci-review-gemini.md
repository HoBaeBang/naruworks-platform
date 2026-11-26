<!-- naru-orch job=P2-11-obs-10-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=2038eeb1-561f-46bb-a281-741f5e5d6458 saved=2026-11-26T21:50:28+09:00 -->

## 1. 요약

- **심각도 개수**: blocking **0건** / major **0건** / minor **0건** (총 **0건**)
- **로그 30일·마스킹**: 운영 로그 30일 보관([NFR-OPS-002](../../../docs/01-planning/nfr/NFR.md#L188-L193), [DEC-044](../../../docs/01-planning/02-decision-log/decision-log.md#L48)), 성공 지표 집계 별도 보관(DEC-085), 토큰·시크릿·이메일 원문 마스킹(PV-016) 및 제한적 `member_id` 기록 제안을 일관되게 반영했다.
- **추적 선택**: 1차 추적으로 [ADR 0003](../../../docs/decisions/0003-backend-stack.md#L17)의 `tracing` + `tower-http`(`TraceLayer`)를 제안하고, OpenTelemetry는 분산 추적이 필요할 때 검토하는 후속 안으로 두었다.
- **경보-NFR 연결**: 저장 용량 경보(NFR-OPS-004·업로드 미차단), 가입자 80·100명 경보(NFR-PERF-001·004·가입 미차단), 활성 세션 20명 오류율 ≤0.1%, p95 응답 시간, 월 99% 가용률, 일일 백업(NFR-OPS-001)을 기획 기준과 [04 기술 NFR](../../../docs/02-architecture/04-NFR-technical.md) 제안값으로 구분해 연결하고 Q-092 등을 `[미확인]`으로 유지했다.
- **헬스·감사**: [07 OpenAPI v0.3](../../../docs/02-architecture/07-api/openapi.yaml#L44-L80)에 헬스 경로가 없음을 확인하고 `/livez`·`/readyz`를 제안으로만 기술했으며, 관리자 감사 4동작(NFR-OPS-003·DEC-104)은 Q-091 확인 뒤 08 개정으로 두고 [08 DB 스키마](../../../docs/02-architecture/08-db/08-db-schema.md#L198-L209)의 `deletion_events`와 구분했다.
- **현행 CI vs 제안 게이트**: 현행 Java 21·Node 22 CI([pr-ci.yml](../../../.github/workflows/pr-ci.yml))와 이슈 자동 종료([close-linked-issues.yml](../../../.github/workflows/close-linked-issues.yml))를 사실대로 기록하고, Rust CI 게이트 명령과 브랜치 보호는 별도 **제안**으로 분리해 워크플로·Dockerfile을 생성하지 않았다.

---

## 2. 설계 결함 표

남은 blocking/major 없음 (minor 포함 총 0건).

---

## 3. 점검 목록

| 번호 | 검토 항목 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | 23장·ADR 0003·기획 NFR과의 일치 | **충족** | [10-observability-ci.md](../../../docs/02-architecture/10-observability-ci.md#L13-L15)가 로그·트레이싱·지표·CI·컨테이너 빌드를 모두 다루고, ADR 0003의 `tracing`+`tower-http`를 따르며, 비밀 값 없이 보관 위치([CO-01~03](../../../docs/01-planning/carry-over/README.md#L7-L11))만 표기했다. |
| 2 | 기획 DEC/NFR 반영 | **충족** | [10 §2·§4·§6](../../../docs/02-architecture/10-observability-ci.md#L39-L81)에 NFR-OPS-002(30일·DEC-044, 지표 별도·DEC-085), NFR-OPS-003(4동작·DEC-104), NFR-OPS-004(용량 경보·업로드 미차단·DEC-105), DEC-088(80·100명·활성 세션 20명 오류율 ≤0.1%)이 원문과 모순 없이 반영됐다. |
| 3 | 07·08·09 정합·비수정 | **충족** | [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml#L44)에 헬스 경로가 없고, [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L198)에 감사 테이블이 확정되지 않았으며, [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L60-L89)의 크레이트·`crates/naru-adapters/migrations` 경로와 일치하고, [09-auth.md](../../../docs/02-architecture/09-auth.md#L130)의 B-2 기본안·결정 대기 상태를 유지했다. |
| 4 | 관측 완전성 | **충족** | [10 §2~§6](../../../docs/02-architecture/10-observability-ci.md#L26-L81)에서 구조화 필드·마스킹·보존·지표·추적·경보-NFR 연결·헬스체크·감사를 모두 다루며 빈 표나 본문 모순이 없고, 미검증 도구·방식은 후보/제안 및 `[미확인]`으로 구분했다. |
| 5 | 현행 CI 현황의 사실성 | **충족** | [10 §1](../../../docs/02-architecture/10-observability-ci.md#L17-L24)의 트리거·잡·명령·권한·템플릿 요약이 [pr-ci.yml](../../../.github/workflows/pr-ci.yml#L1-L55), [close-linked-issues.yml](../../../.github/workflows/close-linked-issues.yml#L1-L55), PR/이슈 템플릿과 일치하며 목표 Rust CI와 구분했다. |
| 6 | CI·브랜치 제안의 범위 | **충족** | `.github/workflows/`에 새 파일이 없고 루트에 `Dockerfile`도 없으며, [10 §7·§8](../../../docs/02-architecture/10-observability-ci.md#L83-L108)에서 게이트 명령·브랜치 보호를 제안으로 두고 프런트 스택을 미정으로 남겼다. |
| 7 | 금지·미확인을 단정하지 않았는지 | **충족** | [10 §10](../../../docs/02-architecture/10-observability-ci.md#L121-L136) 및 본문에서 RB-017, GAP-016·018·025, Q-081·085·087·091·092, DM-002·004·006·007·009·010·011, SSO 최종 채택, CO-03, 배포 호스트, 용량 경보 수치·수신자·방법, 감사 보관 기간·법적 적정성을 모두 `[미확인]`으로 유지했고 비밀 값을 적지 않았다. |

---

## 4. 현행 CI 기록의 정확성과 제안 게이트 목록 확인

### 현행 CI 기록 대조 ([10 §1](../../../docs/02-architecture/10-observability-ci.md#L17-L24))
- **`PR CI`** ([pr-ci.yml](../../../.github/workflows/pr-ci.yml)): `develop`·`main` 대상 `pull_request`와 `push`, `cancel-in-progress: true`, `permissions: contents: read`, `backend-test`(`Backend Test`, `ubuntu-latest`, `backend/`, Temurin Java 21, Gradle 캐시, `./gradlew clean test`), `frontend-quality`(`Frontend Quality`, `ubuntu-latest`, `frontend/`, Node 22, `frontend/package-lock.json` npm 캐시, `npm ci` → `npm run lint` → `npm run build`) — 실제 파일과 일치.
- **`Close Linked Issues`** ([close-linked-issues.yml](../../../.github/workflows/close-linked-issues.yml)): `pull_request` `closed`, `merged == true && base.ref == 'develop'`, `permissions: issues: write, pull-requests: read`, `actions/github-script@v8`, `close/fix/resolve` 계열 키워드 + `#번호` 대소문자 무관 매칭·중복 제거·열린 이슈 종료·실패 시 `core.warning` — 실제 파일과 일치.
- **PR·이슈 템플릿**: [PULL_REQUEST_TEMPLATE.md](../../../.github/PULL_REQUEST_TEMPLATE.md), [release.yml](../../../.github/ISSUE_TEMPLATE/release.yml), [feature.yml](../../../.github/ISSUE_TEMPLATE/feature.yml)의 검증 항목·입력 필드 요약이 실제 파일과 일치.
- **협업 문서의 Ruleset 인용** ([10 §8](../../../docs/02-architecture/10-observability-ci.md#L108)): [github-workflow.md](../../../docs/development/github-workflow.md#L112-L135)의 2026-09-16 `main` Ruleset(`Backend Test`, `Frontend Quality`) 및 `develop` 보호 후속 항목 기록과 일치.

### 제안 게이트 목록 확인 ([10 §7](../../../docs/02-architecture/10-observability-ci.md#L83-L99))
- **Rust 포맷**: `cargo fmt --all -- --check` (제안)
- **Rust 정적 검사**: `cargo clippy --workspace --all-targets -- -D warnings` (제안)
- **PostgreSQL 마이그레이션 검사**: 임시 PostgreSQL에서 `sqlx migrate run --source crates/naru-adapters/migrations` (경로는 [06 §3](../../../docs/02-architecture/06-crate-layout.md#L68-L75)과 일치)
- **Rust 시험**: `cargo test --workspace` (`#[sqlx::test]`는 ADR 0003 후속 검증 안 따름)
- **`query!` 재도입 시**: `cargo sqlx prepare --workspace`로 `.sqlx` 생성·갱신, CI에서 `cargo sqlx prepare --check --workspace`, 오프라인 빌드 `SQLX_OFFLINE=true` (현 단계 필수 게이트 제외는 ADR 0003의 2026-11-19 결정과 일치)
- **OpenAPI 린트**: 후보 명령 `redocly lint --extends=spec docs/02-architecture/07-api/openapi.yaml` (`[미확인]` 유지)
- **프런트엔드**: 자리만 두고 스택 결정 후 확정 (04·06·ADR 0003과 일치)
- **컨테이너 빌드**: 다단계 빌드 검증 제안, Dockerfile 경로·레지스트리·아키텍처·배포 호스트 `[미확인]`

---

## 5. 남은 `[미확인]` 목록 (10 §10과 원문 대조)

| 항목 | 10 §10 기술 | 원문 대조 결과 |
| --- | --- | --- |
| RB-017 | CO-02 프록시 경로·본문 한도와 1 GiB 단일 업로드 양립 여부 | [04 §4.1·§5](../../../docs/02-architecture/04-NFR-technical.md#L135)와 일치 |
| GAP-016·018·025 | 기획 기본 보안선, 지원 브라우저 ‘최신’ 정의·iOS 타 브라우저, Litpage 자동 저장·1 GiB·무손실 패키징 | [04 §5](../../../docs/02-architecture/04-NFR-technical.md#L269-L277)와 일치 |
| Q-081·Q-091 | 사업자·운영자 정보 법적 요건, 감사 항목·보관 기간·로그 30일 적용 여부·법적 적정성 | [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L20-L23)와 일치 |
| Q-085·Q-087 | 달력 날짜 30일 시간대·경계·시작일, 열린 세션 갱신 주기·정지 후 차단 최대 시간 | [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L21-L22)와 일치 |
| Q-092 | 전체 저장 용량 경보 기준 수치·수신자·방법 | [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L24)와 일치 |
| DM-002/004/006/007/009/010/011 | 07·08의 디자인 대응 보류 항목 | [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L219), [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L283)와 일치 |
| SSO | 09의 B-2 기본안 최종 채택(호배님 결정 대기) | [09-auth.md §4](../../../docs/02-architecture/09-auth.md#L130)와 일치 |
| CO-03 | 기존 OAuth 클라이언트 재사용·재발급 및 redirect URI 재사용·추가 등록 여부 | [carry-over/README.md](../../../docs/01-planning/carry-over/README.md#L16), [09-auth.md](../../../docs/02-architecture/09-auth.md#L20)와 일치 |
| 운영 | 배포 호스트·레지스트리, 런타임 시크릿 위치, 관측 저장소, 성공 지표 집계 항목·기간, 분산 추적·헬스체크 범위, §4 미확인 경보 설정 | 본문 §2~§5·§7·§9 및 [04 §4.6·§4.7](../../../docs/02-architecture/04-NFR-technical.md#L215-L222)와 일치 |
| CI·브랜치 | 설계서 4·23·29장 원문, 실제 Ruleset 상태, 최종 게이트·실행 결과, 후속 구현 권한 | 10 §7·§8 및 [github-workflow.md](../../../docs/development/github-workflow.md#L110-L135)와 일치 |

---

## 6. 10과 04/05/06/07/08/09 사이 불일치

확인된 불일치 없음.

---

## 7. 검토하지 못한 부분과 이유

- **`git status`·`git log`·`git diff` 및 브랜치/커밋 해시 검증 (`[미확인]`)**: 현재 작업 폴더(`/Users/banghobae/.naru-orch/review/arch-obs-10-review-01`)가 `.git` 디렉터리가 없는 읽기 전용 사본이므로, 10 문서 머리말의 `HEAD 24b5849` 및 `develop 2f1db92` 커밋 이력과 다른 파일의 미수정 여부를 git 명령으로 직접 검증하지 못했다.
- **실제 GitHub 저장소 Ruleset·Secrets·CI 실행 결과 (`[미확인]`)**: 읽기 전용 로컬 검토이므로 원격 GitHub Settings의 Ruleset 적용 상태와 Rust CI·OpenAPI 린터·임시 PostgreSQL 마이그레이션 실행 결과는 확인하지 못했다.
- **설계서 4·23·29장 원문 대조 (`[미확인]`)**: 10 §1·§8·§10이 언급한 설계서 4·23·29장 원문은 본 검토 범위 파일 목록에 없어 직접 대조하지 못했다.