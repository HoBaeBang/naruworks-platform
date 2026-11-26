<!-- naru-orch job=P2-4-arch-05-06-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=0c23a53d-5bbe-4302-bdae-930cc7208110 saved=2026-11-19T14:18:38+09:00 -->

### 1. 요약

- **판정**: **경미** (설계 방향·기준선·스택·세션/정지 정책·의존 구조에 `blocking` 또는 `major` 결함 없음)
- **대상 문서별 심각도 개수**:
  - [05-architecture.md](../../../docs/02-architecture/05-architecture.md): `blocking` 0 / `major` 0 / `minor` 4
  - [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md): `blocking` 0 / `major` 0 / `minor` 2

---

### 2. 발견 표

| 번호 | 심각도 | 위치 | 유형 | 내용 | 근거 | 수정 제안 |
|---|---|---|---|---|---|---|
| RV-001 | minor | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L248) (§7) | 1·7 | 휴지통 만료 삭제 행에 "운영 관측은 NFR-OPS-002를 따른다"고 적었으나, `NFR-OPS-002`는 모니터링·관측 규정이 아니라 **로그 30일 보관** 규정임 | [NFR.md](../../../docs/01-planning/nfr/NFR.md#L159-L164) (§4.5 `NFR-OPS-002`) | "삭제 작업 로그는 NFR-OPS-002(30일 보관)를 따른다"로 표현을 구체화 |
| RV-002 | minor | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L216) (§6.4, §1.1) | 7 | §6.4에서 `Q-후보-19`를 인용했으나, §1.1 입력 기준선 표에는 `Q-후보-19`가 있는 `readme-analysis.md`가 빠져 있음 | [readme-analysis.md](../../../docs/01-planning/00-context/readme-analysis.md#L159) (`Q-후보-19`), [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L23-L38) (§1.1) | §1.1에 `readme-analysis.md`를 추가하거나 `Q-후보-19` 출처 경로를 병기 |
| RV-003 | minor | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L129) (§6.1) | 1 | §6.2·§6.3·§6.4·§7과 달리 §6.1 첫 문장(`FR-DRV-003, NFR-PERF-002.`)에만 `[기획]` 표기가 누락됨 | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L129) (§6.1) vs [§6.2](../../../docs/02-architecture/05-architecture.md#L167) | `[기획] FR-DRV-003, NFR-PERF-002.`로 표기 통일 |
| RV-004 | minor | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L43) (§1.2, §11) | 7 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L375) (§8.1)가 `NFR-AVAIL-001`(월 99% 가용률)을 05에 연결했으나, 05는 배포 구성을 후속 문서로 이관하면서 `NFR-AVAIL-001`·`GAP-008` 이관 표기를 생략함 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L375), [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L43) (§1.2) | §1.2 또는 §11에 `NFR-AVAIL-001`·`GAP-008`의 후속 배포/운영 문서 이관을 명시 |
| RV-005 | minor | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L177) (§9) | 7 | §5 `인증·세션` 모듈 책임에 로그인 판정이 포함되지만 §9 추적 표의 `§5 인증·세션·회원` 행에 `FR-AUTH-001`이 빠짐 | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L130) (§5), [§9](../../../docs/02-architecture/06-crate-layout.md#L177) | §9 `§5 인증·세션·회원` 행의 기획 기준선 열에 `FR-AUTH-001` 추가 |
| RV-006 | minor | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L130-L135) (§5) | 3 | §5 표에서 `인증·세션`·`드라이브 업로드`·`회원 상태`는 `시계`, `만료·정리 작업`은 `JobClock`으로 적어 동일 시각 추상화인지 별도 포트인지 구분이 모호함 | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L126-L135) (§5) | `시계`를 `Clock`(공통 시각 포트)으로 통일하거나 `JobClock`과의 관계를 한 줄로 명시 |

---

### 3. 05와 06 사이 불일치 목록

- **없음.**
  - 정지·세션 정책(유휴 7일 / 절대 30일, 신규 로그인·리프레시 회전·Litpage SSO 진입 차단, 살아있는 액세스 토큰 즉시 회수 금지, 짧은 수명 `PV-017` 전제)이 [05 §6.4](../../../docs/02-architecture/05-architecture.md#L218)와 [06 §5](../../../docs/02-architecture/06-crate-layout.md#L137)에서 일치함.
  - 컴포넌트 의존 방향([05 §5](../../../docs/02-architecture/05-architecture.md#L100-L123))과 크레이트 의존 금지 규칙([06 §4](../../../docs/02-architecture/06-crate-layout.md#L97-L122))이 일치함.
  - 미결 ADR 경계(인증/IdP·세션=09 이관, 파일 저장소, 잡 러너, 프런트엔드 스택)가 양쪽에서 동일하게 `[ADR 대기]`로 유지됨.

---

### 4. 04와의 교차 이슈 목록

| 이슈 | 04 내용 | 05·06과의 관계 | 표기 상태 |
|---|---|---|---|
| 정지 후 기존 세션 시험 절차 | [04 §3 NFR-SEC-002](../../../docs/02-architecture/04-NFR-technical.md#L107) 및 `PV-029`: 정지 후 T+1시간 기존 세션 API 200, 같은 세션으로 Litpage 진입 허용 | 2026-11-19 확정(리프레시 회전·Litpage SSO 진입 차단, 짧은 액세스 토큰 수명)과 어긋남 | **이미 기재** ([05 §6.4](../../../docs/02-architecture/05-architecture.md#L240), [06 §8](../../../docs/02-architecture/06-crate-layout.md#L168)) |
| 세션 수명 부재·토큰 갱신 모호성 | [04 §5 GAP-012·034](../../../docs/02-architecture/04-NFR-technical.md#L273), `PV-018` 주석("기획에 만료 정책 없음") | 2026-11-19 확정으로 설계 입력에서는 해소(기획 커밋 전) | **이미 기재** ([05 §6.4](../../../docs/02-architecture/05-architecture.md#L218)) |
| 백업 복원 시 삭제 데이터 부활 | [04 §5 GAP-010](../../../docs/02-architecture/04-NFR-technical.md#L271) | 2026-11-19 라운드 16 확정(30일 자동 소멸, 복원 시 삭제 재적용, 커밋 전)으로 `PV-015` 채택 | **이미 기재** ([05 §7](../../../docs/02-architecture/05-architecture.md#L255)) |
| 모바일 hover 썸네일 불가 | [04 §5 GAP-017](../../../docs/02-architecture/04-NFR-technical.md#L278) | 2026-11-19 확정 `DEC-084`(모바일 썸네일 미리보기 생략, 커밋 전) | **이미 기재** ([05 §7](../../../docs/02-architecture/05-architecture.md#L251), [05 §9](../../../docs/02-architecture/05-architecture.md#L269)) |
| 설계 문서 번호 체계 | [04 §8.2](../../../docs/02-architecture/04-NFR-technical.md#L387) (`AS-002` 추정: 05=시스템 구성·배포, 06=인증·IdP·세션) | 실제 산출물은 05=아키텍처, 06=크레이트 구조, 09=인증/IdP ADR | **이미 기재** ([05 §1.2](../../../docs/02-architecture/05-architecture.md#L43), [06 §1.2](../../../docs/02-architecture/06-crate-layout.md#L43)) |

---

### 5. [미확인]·[ADR 대기] 점검

- **`[ADR 대기]` 적절성**: 인증/IdP·세션(09 이관), 파일 저장소, 잡 러너, 프런트엔드 스택 모두 대안만 나열([06F](../../../docs/02-architecture/06F-stack-feasibility.md#L286-L293) 범위 내)하고 결정하지 않음. 정상.
- **`[미확인]` 적절성**:
  - `4b66d1d` 커밋 객체 일치 여부(`GAP-001·029`), `CO-01~03` 실제 계정·경로(`GAP-003`), Cloudflare 프록시 경유·본문 한도(`GAP-005`), 배포 토폴로지·IaC, 토큰 수명만으로 로그아웃 전파 목표 충족 여부, 미완료 업로드 조각 정리 스위프 주기, 실제 PostgreSQL `#[sqlx::test]`·`query_as` 실행 및 동시 부하, 환경별 설정 파일 위치, `docs/03-ui-design` 부재 등이 빠짐없이 `[미확인]`으로 표시됨.
  - [06 §8](../../../docs/02-architecture/06-crate-layout.md#L170)에 PostgreSQL 실제 시험에 필요한 권한(`PostgreSQL 설치·실행 승인`)도 명시됨.

---

### 6. 검토하지 못한 부분과 이유

- **커밋 `4b66d1d` 실제 git 객체와의 대조**: `[미확인]` (작업 규칙상 git 명령 실행 금지로 워크트리 파일 원문만 대조함).
- **`UF.md`, `traceability/matrix.csv` 전체 행, `open-questions.md` 원문**: 05·06이 인용한 핵심 ID(`NFR`, `FRD`, `BR`, `DEC-001~080`, `AC-FR-DRV-007-04`, `AC-FR-AUTH-005-02`, `PRD CO-01~03`, `Q-후보-19`)와 [04](../../../docs/02-architecture/04-NFR-technical.md)·[06F](../../../docs/02-architecture/06F-stack-feasibility.md)·[ADR 0003](../../../docs/decisions/0003-backend-stack.md)·[ADR 0002](../../../docs/decisions/0002-open-source-service-platform.md)는 직접 대조했으나, `UF.md`·`matrix.csv` 전체 행은 직접 읽지 않아 `[미확인]`임.
- **2026-11-19 커밋 전 확정 사항(DEC-101, DEC-102, DEC-084, 라운드 16 백업 결정, 세션·정지 확정)의 별도 원문 파일**: `4b66d1d` 저장소에 아직 없어 작업 지시문에 적힌 전제를 기준으로 대조함(`[미확인]`).
