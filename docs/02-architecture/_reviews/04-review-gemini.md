<!-- naru-orch job=P2-1-nfr-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium snapshot=arch-04-review-01 copied=2026-11-19T11:51:41+0900 (save-result는 docs/01-planning만 허용하여 수동 복사, 링크는 상대 경로로 변환) -->

### 1. 요약

- **판정**: **수정 필요**
- **심각도별 개수**: `blocking` **0건** / `major` **6건** / `minor` **4건**
- **핵심 확인 사항**:
  - [NFR.md](../../01-planning/nfr/NFR.md)의 18개 NFR ID는 [04-NFR-technical.md](../../02-architecture/04-NFR-technical.md) §3 표와 §8.1 추적 요약에 모두 누락 없이 포함됨.
  - `[기획]` 표기 및 출처 `DEC-###` 인용은 기준 문서와 정합하며, 프런트엔드 스택 특정 및 비밀 값 기재는 없음.
  - 다만 일부 행의 측정 절차 누락·모순(`NFR-SEC-001/002/003`, `NFR-PERF-003`), §6 제안값(`PV-022·023`)의 §3/§4 누락, `PV-026`과 `GAP-019` 간 전제 불일치 보완이 필요함.

---

### 2. 발견 표

| 번호 | 심각도 | 위치 | 유형 | 내용 | 근거 | 수정 제안 |
|---|---|---|---|---|---|---|
| RV-001 | major | §3 `NFR-SEC-002` 행 (`측정 방법`, `PV-018`) | 3 (측정 불가·모호) | 기존 세션 유지 확인 절차에서 나루 API(`기존 세션 API 200 확인`)만 검증하고 **연동 오픈소스(Litpage) 사용 가능 여부**를 검증하지 않음. 또한 `PV-018`에 둔 유휴 7일·절대 30일 상한의 검증 절차가 빠져 있음. | [NFR.md §4.2 NFR-SEC-002](../../01-planning/nfr/NFR.md#L104-L109), [AC.md AC-FR-AUTH-005-02](../../01-planning/acceptance-criteria/AC.md#L108-L112) | 측정 절차에 정지 후 기존 세션으로 Litpage 진입·사용 확인 및 유휴 7일·절대 30일 경과 시 만료 확인 단계를 추가. |
| RV-002 | major | §3 `NFR-SEC-003` 행 (`측정 방법`, `PV-019`) | 3·5 (측정 불가·내부 모순) | `PV-019`는 링크 보기 요청을 `IP당 분당 60회`로 제한하면서, 같은 행 추측 시험은 `무작위 토큰 10,000건 요청, 적중 0`을 요구함. 단일 IP에서 실행하면 61회째부터 HTTP 429로 차단되어 토큰 추측 불가성이 아닌 레이트 리밋만 시험하게 됨. | [04-NFR-technical.md §3 NFR-SEC-003](../../02-architecture/04-NFR-technical.md#L101) | 추측 시험은 스테이징 레이트 리밋 예외(또는 다중 IP/분산 실행) 조건을 명시하거나, 128비트 CSPRNG 검증을 단위 시험으로 분리. |
| RV-003 | major | §3 `NFR-SEC-001` 행 (`PV-017` ↔ `측정 방법`) | 3 (측정 불가·불일치) | `PV-017`은 `전파 p99 ≤ 5초`와 `로그아웃 API p95 ≤ 2초`를 목표로 두었으나, 측정 방법은 `10회 반복`, `5초 안에 전부 거부(실패 0건)`(p100)만 확인하고 `로그아웃 API p95 ≤ 2초` 측정·합격 조건이 누락됨. | [04-NFR-technical.md §3 NFR-SEC-001](../../02-architecture/04-NFR-technical.md#L99) | `로그아웃 API p95 ≤ 2초` 측정 방법(예: 30회 반복 또는 부하 시험 트렌드)을 추가하고 전파 지연의 반복·백분위 기준을 일치시킴. |
| RV-004 | major | §6 `PV-022`, `PV-023` (및 §3·§4 전반) | 3 (측정 불가·누락) | `PV-022`(TLS 1.2+, HSTS, 쿠키 속성)와 `PV-023`(업로드 동시 3건·분당 30건, 가입 IP당 시간당 10건)이 §6 목록에만 있고 §3 표·§4 상세에 반영되지 않아 측정 도구·환경·합격 조건이 없음. | [04-NFR-technical.md §6 PV-022~023](../../02-architecture/04-NFR-technical.md#L301-L302) | §4에 `4.9 기본 보안선` 절을 추가하거나 §3 관련 행(`NFR-PERF-002`, `NFR-SEC-*`)에 헤더·쿠키·429 검증 절차를 명시. |
| RV-005 | major | §3 `NFR-PERF-003` 행 (`측정 방법`), §4.2 | 3 (측정 불가·모호) | `lighthouse <STAGING_URL> --preset=desktop`만으로는 로그인 필요 화면(WF-02~07, 09~16) 인증 처리 및 모바일 프로파일(`P-MOB`) 측정이 불가함. 또한 `WF-09 탈퇴 확인`·`WF-10 차단 안내`는 상태 변경 없이 화면 진입만 30회 반복하는지 전제가 불명확함. | [04-NFR-technical.md §3 NFR-PERF-003](../../02-architecture/04-NFR-technical.md#L97), [§4.2](../../02-architecture/04-NFR-technical.md#L146) | Lighthouse 인증 세션 전달 방식과 모바일 프리셋 실행 조건을 명시하고, WF-09/10 반복은 상태 변경 전 화면 진입 기준임을 명시. |
| RV-006 | major | §3 `NFR-I18N-002` (`PV-026`) ↔ §5 `GAP-019` | 5 (PV 내부 모순) | `GAP-019`는 "로그인 전 화면에서 언어를 고를 수단이 없다(프로필에서만 설정)"고 적고 있으나, `PV-026`은 "로그인 전 값은 브라우저 저장소"에 둔다고 제안함. 로그인 전 전환 UI가 없는 상태에서 브라우저 저장소 값이 언제 생성·갱신되는지 모순됨. | [04-NFR-technical.md §3 NFR-I18N-002](../../02-architecture/04-NFR-technical.md#L111), [GAP-019](../../02-architecture/04-NFR-technical.md#L259), [decision-log.md DEC-045·052](../../01-planning/02-decision-log/decision-log.md#L49-L56) | `PV-026`의 브라우저 저장소가 "직전 로그인 사용자의 선택 캐시"인지 "GAP-019 해소 시 추가할 로그인 전 전환 UI용 저장"인지 명확히 구분. |
| RV-007 | minor | §5 `GAP-022` | 6 (GAP 목록 불완전) | `matrix.csv` 84~101행 중 FR·REQ·BR 연결이 없는 NFR 목록에서 `NFR-PERF-001`(84행)과 `NFR-I18N-001`(99행)이 빠짐. 또한 `OPS-001 ↔ FR-DRV-004` 미연결을 지적했으나, 기획(`NFR.md`·`DEC-046`)은 백업과 휴지통을 의도적으로 분리함. | [matrix.csv 84~101행](../../01-planning/traceability/matrix.csv#L84-L101), [NFR.md §4.5 NFR-OPS-001](../../01-planning/nfr/NFR.md#L154-L157) | `GAP-022`에 `PERF-001(84행)`, `I18N-001(99행)`을 추가하고, `OPS-001 ↔ FR-DRV-004`는 휴지통과 별개라는 기획 의도를 구분해 서술. |
| RV-008 | minor | §3 `NFR-PERF-003` 행 (`관련 FR/AC/BR`) | 1 (참조 표기 오류) | `(matrix 86행은 이 둘뿐)`이라고 적었으나, 실제 `matrix.csv` 86행 BR 열에는 `BR-012;BR-018`이 모두 기재되어 있음. | [matrix.csv 86행](../../01-planning/traceability/matrix.csv#L86) | `FR-DRV-008, BR-012, BR-018, REQ-016`으로 정정. |
| RV-009 | minor | §3 `NFR-PERF-004`, `NFR-OPS-001`, `NFR-OPS-002` | 2 (제안값/추정 표기 누락) | `화면당 API 약 4회`(PERF-004 산술), `파일 샘플 1%`(OPS-001 합격 조건), `로그 샘플 1만 줄`(OPS-002 시험) 등 임의 수치가 `[제안값]`/`[추정]`/`PV-###` 표기 없이 기재됨. | [04-NFR-technical.md §3](../../02-architecture/04-NFR-technical.md#L98-L107) | 각 수치에 제안값·추정 표기를 붙이거나 해당 `PV-009·014·016` 정의에 포함. |
| RV-010 | minor | §3 `NFR-OPS-002` 행 (`PV-016`) | 5 (내부 모호성) | `30×24시간, 매일 1회 로테이션 삭제`로 정의하면 일 1회 배치 시점까지 최대 약 31일(30일+24시간) 분의 로그가 남을 수 있음. | [04-NFR-technical.md §3 NFR-OPS-002](../../02-architecture/04-NFR-technical.md#L107) | "30×24시간 경과분을 일 1회 로테이션 시 삭제(최대 24시간 지연 허용)"로 허용 지연을 명시. |

---

### 3. 누락 GAP 제안 목록

1. **탈퇴 회원이 '공유받은' 파일 및 30일 보관 중 편집 권한 공유 처리 (`FR-AUTH-003`, `FR-DRV-006`, `BR-007`)**
   - `GAP-013`은 **정지 회원**의 탈퇴·재가입 및 정지 회원 소유의 공유·링크만 다루고 있음. 탈퇴 후 30일 보관 기간 동안 탈퇴 회원이 **소유한** 파일의 공유·링크는 유지되는데(`DEC-029`), 다른 회원이 그 파일에 **편집 권한**을 가지고 계속 수정할 수 있는지, 반대로 탈퇴 회원이 **공유받았던** 접근 권한은 즉시 회수되는지 기준 문서([FRD.md](../../01-planning/frd/FRD.md#L297-L305), [BR.md](../../01-planning/business-rules/BR.md#L100-L104))에 명시되지 않음.
2. **정지 회원의 기존 세션 유지(`NFR-SEC-002`) ↔ 단기 액세스 토큰(`PV-017`) 및 오픈소스 신규 진입 상호작용**
   - `PV-017`대로 액세스 토큰 수명을 5분 이하로 두면, 정지된 회원의 기존 세션이 5분 후 토큰 갱신 또는 Litpage 첫 진입(OIDC SSO)을 시도할 때 "기존 세션 유지"(`NFR-SEC-002`, [NFR.md](../../01-planning/nfr/NFR.md#L108))와 "다음 로그인 차단"을 IdP/세션 계층에서 어떻게 구분할지 설계 영향이 큼.
3. **연동 오픈소스(Litpage) 내부 UI 언어의 NaruWorks 언어 설정 동기화 여부 (`NFR-I18N-001`, `NFR-I18N-002`, `FR-OSS-001`)**
   - `NFR-I18N-001`은 나루 화면과 공통 헤더·푸터를 대상으로 적고 있으나, 연동 오픈소스인 Litpage 자체 UI도 한국어·영어를 함께 전환·유지해야 하는지 여부가 기획에 없음.

---

### 4. `[미확인]` 항목 목록과 처리 제안

| 위치 | `[미확인]` 내용 | 기준 문서 해소 가능 여부 | 처리 제안 |
|---|---|---|---|
| §1.1 (22행) | [PRD.md](../../01-planning/prd/PRD.md#L130-L142) §6 성공 지표가 `[미확인]` 상태임 | **부분 해소 가능** ([change-proposal-prd-v1.1.md](../../01-planning/change-proposal-prd-v1.1.md#L64-L75) 및 `DEC-080` 승인⑤로 수치 확정 완료, PRD.md 본문만 미개정) | `GAP-002` 상태 그대로 두고, PRD v1.1 반영 시점에 `[미확인]` 주석 제거. |
| §1.1 (37행), AS-014 (325행) | 읽지 않은 입력(`01-interview/`, `wireframe/exports`, `00-context/readme-analysis.md`, `docs/03-ui-design/`)에 결론이 의존하지 않는지 `[미확인]` | 기준 문서 중 `00-context/readme-analysis.md`·`01-interview/`는 열람 가능하나 본 검토에서도 미열람 `[미확인]` | 필요 시 해당 폴더 내 수치 언급 여부만 대조 확인 후 AS-014 해소. |
| §3 `NFR-SEC-005` (103행) | `gitleaks` 등 시크릿 스캐너의 버전별 하위 명령 `[미확인]` | **해소 불가** (도구 구현 세부) | 12/13 문서에서 CI 도구 선정 시 확정. |
| §4.1 (137행), GAP-005 (245행), AS-003 (314행) | Cloudflare 프록시 플랜별 요청 본문 한도(기억상 무료·Pro 100 MB) `[미확인]` | **해소 불가** (`carry-over/` 비어 있어 CO-02 플랜 확인 불가, 외부 공식 문서 확인 필요) | 호배님께 CO-02 플랜·프록시 경유 여부 확인(GAP-003·005) 후 Cloudflare 공식 문서로 한도 검증. |
| GAP-011 (251행) | 개인정보 접속기록 보관기간 법정 요건과 로그 30일 보관의 관계 `[미확인, 법률 확인 필요]` | **해소 불가** (법률 자문 영역) | 정식 배포 전 Q-081과 함께 법률 확인 후 PV-016 조정. |
| GAP-020 (260행) | Google 로그인 설정이 개인정보처리방침 링크를 요구할 수 있음 `[미확인]` | **해소 불가** (외부 Google OAuth 정책) | 06 인증 문서 또는 Google Cloud Console OAuth 동의 화면 설정 시 확인. |

- **단정된 외부 사실 점검**: macOS Finder(10⁹) vs Windows(2³⁰) 표기 관행, Playwright WebKit과 실제 Safari의 엔진 차이, Google 부하 시험 제외 사유(외부 약관·한도)는 일반적·합리적 전제이나, 외부 약관·한도 세부 수치를 단정하지 않아 적절함.

---

### 5. 검토하지 못한 부분과 그 이유

- `docs/01-planning/01-interview/*`, `docs/01-planning/00-context/readme-analysis.md`, `docs/01-planning/change-proposal-v1.2.md`, `docs/01-planning/02-decision-log/change-proposal-v1.1.md`, `docs/01-planning/consistency-check-v1.md`, `docs/01-planning/gemini-consistency-review-01.md`, `docs/01-planning/wireframe/*`: 본 검토에서는 1차 기준 문서(`NFR.md`, `PRD.md`, `FRD.md`, `BR.md`, `AC.md`, `UF.md`, `matrix.csv`, `decision-log.md`, `open-questions.md`, `change-proposal-prd-v1.1.md`, `service-definition.md`, `glossary.md`) 대조를 우선 수행하고 해당 보조·이력 문서는 전문을 열람하지 않아, 해당 문서 내 세부 문구 일치 여부는 `[미확인]`으로 남김.
- `docs/02-architecture/05~13` 및 `docs/03-ui-design/`: 설계 후속 문서 및 UI 설계 문서는 본 검토 범위 밖이므로 정합성 미확인 `[미확인]`.
- `.env*` 및 비밀 파일: 작업 규칙에 따라 열람·출력하지 않았으며, [04-NFR-technical.md](../../02-architecture/04-NFR-technical.md) 본문 내 비밀 값 미기재 여부만 확인함.
