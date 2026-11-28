<!-- naru-orch job=P2-14-test-11-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=7271cbd6-61e7-4d7b-8208-35a554933fc5 saved=2026-11-26T22:23:46+09:00 -->

### 1. 요약

- **심각도 집계**: blocking **0건** / major **0건** / minor **0건** (총 **0건**)
- **AC 커버리지**: **139/139개** 전체 매핑 완료 (기능 Must `AC-FR-*` **109/109개**, 비기능 `AC-NFR-*` **30/30개**, Must 공백 없음)
- **테스트 네 수준**: 단위(`TP-U-…`), 통합(`TP-I-…`, 실 PostgreSQL·`sqlx`), API 계약(`TP-C-…`, OpenAPI v0.4), 종단(`TP-E-…`, B-1 SSO 포함) 및 문서 점검(`TP-R-…`) 모두 정의됨
- **B-1·정지·로그아웃**: Litpage SSO B-1(나루 OP·Litpage 새 RP) 채택, 정지 시 열린 세션 비즉시종료·갱신/진입/재로그인 차단(DEC-098), 현재 기기만 백채널·RP-Initiated 로그아웃(DEC-094·09 §5) 정합
- **10 v0.2 SSO 문구**: `10-observability-ci.md`가 v0.2로 개정되었으며 변경 이력 및 §10에서 B-2 대기 문구 제거 및 B-1 채택 반영 확인
- **남은 `[미확인]`**: RB-017, GAP-016·018·025, Q-081·085·087·091·092, DM-002/004/006/007/009/010/011, CO-03, 배포 호스트, 인증 라이브러리·무손실 왕복 스파이크 및 B-1 실측 모두 `[미확인]` 유지

---

### 2. 설계 결함 표

**남은 blocking/major 없음** (minor 포함 잔여 결함 0건).

---

### 3. 점검 목록

| 번호 | 검토 항목 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | AC 전체 커버리지 | 충족 | [AC.md](../../../docs/01-planning/acceptance-criteria/AC.md)의 `### AC-…` 139개(Must `AC-FR-*` 109개, `AC-NFR-*` 30개) 전부가 [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L33-L210) §3 추적표에 테스트 ID·수준과 함께 매핑됨. |
| 2 | 23장·수준 완전성 | 충족 | [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L21-L31) §2에서 단위, 통합(임시 PostgreSQL·`sqlx`, 08 문서용 SQL 구분, `query!` 제외), API 계약(OpenAPI v0.4), 종단(Litpage B-1 SSO 포함)을 모두 정의함. |
| 3 | SSO B-1·정지·로그아웃 정합 | 충족 | [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L253-L259) §5.1이 B-1, DEC-098(열린 세션 즉시 종료 없음·갱신/진입/재로그인 차단), 현재 기기 백채널·RP-Initiated 로그아웃을 따르며 [10-observability-ci.md](../../../docs/02-architecture/10-observability-ci.md#L17-L23) v0.2에서 B-2 대기 문구 제거됨. |
| 4 | NFR·PV·스파이크 | 충족 | [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L211-L290) §4에 [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L285-L324) §6의 PV-003~PV-035 전체(PV-018 포함)가 연결되었고, §5.4에서 무손실 왕복 검증 통과를 형식 채택 조건으로 유지하며 RB-017은 `[미확인]`으로 둠. |
| 5 | CI·프런트·범위 | 충족 | [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L303-L328) §7~§8에서 [10-observability-ci.md](../../../docs/02-architecture/10-observability-ci.md#L90-L106) §7 게이트와 연결하고 프런트 러너는 미정한 채 자리만 둠. 비밀 값 기재 없음. 스냅샷 mtime상 10(22:19)·11(22:20)만 최신 수정임(git 이력은 `[미확인]`). |
| 6 | `[미확인]` 유지 | 충족 | [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L329-L344) §9와 [10-observability-ci.md](../../../docs/02-architecture/10-observability-ci.md#L128-L143) §10에서 열린 질문·GAP·RB-017·DM·CO-03·스파이크·실측을 추측으로 닫지 않고 `[미확인]`으로 유지함. |
| 7 | 문서 사이 모순 | 충족 | 04 PV, [07-api.md](../../../docs/02-architecture/07-api/07-api.md), [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md), [09-auth.md](../../../docs/02-architecture/09-auth.md), [13-cutover.md](../../../docs/02-architecture/13-cutover.md), [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md) 간 불일치 없음. |

---

### 4. AC 커버리지 상세

- **[AC.md](../../../docs/01-planning/acceptance-criteria/AC.md) 제목(`### AC-…`) 수**: 총 **139개**
  - `AUTH`: 22개 (`AC-FR-AUTH-001-01~06`, `002-01~03`, `003-01~03`, `004-01~04`, `005-01~05`, `006-01`)
  - `HOME`: 4개 (`AC-FR-HOME-001-01~02`, `002-01~02`)
  - `SHELL`: 19개 (`AC-FR-SHELL-001-01~06`, `002-01~04`, `003-01~09`)
  - `OSS`: 9개 (`AC-FR-OSS-001-01~03`, `002-01~04`, `003-01~02`)
  - `DRV`: 39개 (`AC-FR-DRV-001-01~03`, `002-01~02`, `003-01~08`, `004-01~08`, `005-01~02`, `006-01~07`, `007-01~06`, `008-01~03`)
  - `ADM`: 16개 (`AC-FR-ADM-001-01~04`, `002-01~04`, `003-01~04`, `004-01~04`)
  - `NFR`: 30개 (`PERF` 7, `SEC` 7, `AVAIL` 2, `USAB` 3, `OPS` 6, `COMP` 2, `I18N` 3)
- **[11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L33-L210) §3 추적표 수**: 총 **139개** (기능 Must 109개 + 비기능 30개)
- **빠진 ID 목록**: 없음
- **Must(`AC-FR-*`) 수준 공백 목록**: 없음

---

### 5. 남은 `[미확인]` 목록 (11과 10 §10, 원문 대조)

| 항목 | 11 §9 반영 | 10 §10 반영 | 기준 원문 대조 |
| --- | --- | --- | --- |
| RB-017 | Cloudflare 프록시 경로·본문 한도와 1 GiB 단일 요청 양립 및 전환 경로 판정 | CO-02 Cloudflare 프록시 경로·본문 한도와 1 GiB 단일 업로드 양립 여부 | [04 §4.1·§5](../../../docs/02-architecture/04-NFR-technical.md#L135), [13 §6](../../../docs/02-architecture/13-cutover.md#L110) 일치 |
| GAP-016·018·025 | 기본 보안선, 브라우저 ‘최신’·iOS 타 브라우저, 자동 저장 지연·재시도·실패·1 GiB·무손실 패키징·실측 | 동일 범위 유지 | [04 §5](../../../docs/02-architecture/04-NFR-technical.md#L269-L277), [09 §11](../../../docs/02-architecture/09-auth.md#L371-L373) 일치 |
| Q-081·091 | 사업자·운영자 정보 법적 요건, 감사 항목·보관 기간·로그 30일 적용 및 법적 적정성 | 동일 범위 유지 | [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L20-L23) 일치 |
| Q-085·087 | 달력 날짜 30일 시간대·경계·시작일, 열린 세션 갱신 주기·정지 후 차단 최대 시간 | 동일 범위 유지 | [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L21-L22), [09 §11](../../../docs/02-architecture/09-auth.md#L375-L376) 일치 |
| Q-092 | 전체 저장 용량 경보 임계·산정 범위·수신자·방법 | 기준 수치·수신자·방법 | [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L24) 일치 |
| DM-002/004/006/007/009/010/011 | 07·08의 디자인 정합 보류 항목 | 동일 | [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L236), [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L379) 일치 |
| CO-03 | OAuth 클라이언트·redirect URI 재사용/재발급, 접근 권한자·교체 절차 | 기존 OAuth 클라이언트·redirect URI 재사용/재발급·추가 등록 여부 | [carry-over/README.md](../../../docs/01-planning/carry-over/README.md#L16), [09 §1](../../../docs/02-architecture/09-auth.md#L27) 일치 |
| B-1 구현·검증 / SSO | 인증 라이브러리 스파이크, Litpage RP 재부착·등록·진입 컨텍스트·갱신, 웹소켓·MCP 경계, 백채널 재시도·폐기 기록, 전파·종단 실측, 키 회전·캐시 | B-1 채택·B-2 기각 명시 후 라이브러리 스파이크, Litpage RP 재부착 검증, 백채널 전파·웹소켓 폐기·실측 유지 | [09 §11](../../../docs/02-architecture/09-auth.md#L380-L385), [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L123-L124) 일치 |
| 전환·가용성·운영·CI | 배포·리허설 호스트·오리진·토폴로지·IaC, 초기 시드, 동결·롤백 창, NFR-AVAIL 공지·귀책, 레지스트리·런타임 시크릿·관측 저장소·성공 지표·경보·분산 추적·헬스체크·백업 절차, 설계서 4·23·29장, Ruleset·실행 결과 | 배포 호스트·레지스트리·런타임 시크릿·관측 저장소·성공 지표·분산 추적·헬스체크·경보 설정, 설계서 4·23·29장, 실제 Ruleset·실행 결과 유지 | [09 §11](../../../docs/02-architecture/09-auth.md#L384-L385), [13 §6](../../../docs/02-architecture/13-cutover.md#L111-L115) 일치 |

---

### 6. 11·10과 04/07/08/09/13/ADR 0004 사이 불일치

직접 대조한 범위 내에서 **불일치 없음**.

---

### 7. 검토하지 못한 부분과 이유

- **이전 커밋 대비 변경 파일 diff (`[미확인]`)**: 현재 폴더가 `.git` 메타데이터가 없는 읽기 전용 스냅샷이어서 `git status`/`git log`/`git diff`를 실행할 수 없었음(`ls -la` 기준 파일 수정 시각은 10 `22:19`, 11 `22:20`으로 나머지 설계 문서 20:17~22:04 이후에 수정된 것으로 확인됨).
- **설계서 4·23·29장 원문 대조 (`[미확인]`)**: 작업 지시문에 요약된 23장 정의 외에 설계서 원문 파일은 본 검토에서 직접 대조하지 않음.
- **05·06·06F·OpenAPI YAML·0001_init.sql·0003 ADR 전체 정밀 대조 (`[미확인]`)**: `11-test-plan.md`와 `10-observability-ci.md`의 핵심 기준선인 AC·04·07·08 스키마·09·13·ADR 0004·open-questions·carry-over를 직접 열람·대조했으며, `05-architecture.md`, `06-crate-layout.md`, `06F-stack-feasibility.md`, `openapi.yaml` 본문 전체 대조는 수행하지 않음.