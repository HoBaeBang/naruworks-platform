<!-- naru-orch job=P2-15-wbs-12-spikes-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=56847981-9047-472e-869e-15780cc895de saved=2026-11-26T22:42:48+09:00 -->

# 12 작업 분해 및 스파이크 계획 검토 결과

## 1. 요약

| 항목 | 결과 |
| --- | --- |
| 결함 건수 | **blocking 0건**, **major 0건**, **minor 4건** |
| 이슈 수 | **40개** (`SPIKE-*` 2, `BE-01`~`BE-37` 37, `FE-PLACEHOLDER` 1) — Markdown과 CSV 100% 일치 |
| 핵심 경로 타당성 | **타당함.** 백엔드 최장 선행 경로(`BE-01`→`02`→`03`→`06`→`08`→`15`→`16`→`18`→`21`→`13`→`25`→`27`→`33`→`35`→`36`→`37`)와 인증·왕복 스파이크 합류 경로(`BE-32`→`BE-33`)가 선행 의존 및 공수 상한과 부합함 |
| 스파이크 기준 측정 가능성 | **측정 가능.** `SPIKE-AUTH`는 09 §4~5 계약별 검증·경합 중복 0건·전파 최댓값 ≤5초/API p95 ≤2초(30회) 등 구체 기준을, `SPIKE-MD-ROUNDTRIP`은 2차 재열기에서 누락·변형·오연결·권한 밖 노출 각 0건 및 실패 시 임의 전환 금지를 명시함 |
| 한 줄 총평 | B-1·DEC-090·DEC-094·DEC-098 및 무손실 실패 절차를 일관되게 반영했고 Must AC 139개·PV 33개를 누락 없이 연결한 완성도 높은 초안이며, 사소한 TP·선행 표기 보완(minor 4건)만 반영하면 승인 가능하다. |

---

## 2. 설계 결함 표

| severity | 파일 | 문제 | 근거(원문 경로) | 수정 제안 |
| --- | --- | --- | --- | --- |
| `minor` | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L52), [12-issues.csv](../../../docs/02-architecture/12-issues.csv#L2) | `SPIKE-AUTH` 문서 §3에는 프로토콜 검증 대상으로 `TP-C-OIDC-KEYS`가 포함되어 있으나, `12-work-breakdown.md` §3 표와 `12-issues.csv`의 `SPIKE-AUTH` 행 `AC / TP`에는 `TP-C-OIDC-KEYS`가 빠져 있음 (`BE-10`에는 포함되어 전체 누락은 아님). | [spike-auth-library.md](../../../docs/02-architecture/spikes/spike-auth-library.md#L49) | `SPIKE-AUTH` 행의 `AC / TP`에 `TP-C-OIDC-KEYS`를 추가하거나, `spike-auth-library.md` §3에서 구현 검증(`BE-10`)과 스파이크 검증 범위를 구분 표기함. |
| `minor` | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L77) | `BE-24`(휴지통 API와 복원)는 `BE-15`만 선행으로 두면서 완료 조건에 "보관 중 공유 차단과 복원 시 재개를 연계 검증한다"고 명시함. `BE-19`(공유)·`BE-21`(공개 링크)보다 앞서 병렬 진행할 경우 해당 연계 검증 시점이 모호해질 수 있음. | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L77), [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L130) | `BE-24` 완료 조건에 "공유·공개 링크 차단의 실제 연계 검증은 `BE-21` 또는 `BE-33`과 통합 확인" 문구를 보완함. |
| `minor` | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L89), [12-issues.csv](../../../docs/02-architecture/12-issues.csv#L39) | `BE-36`(운영 전환과 개방 판정)의 `AC / TP`에 4개 TP만 기재되어 있어 `13-cutover.md` §3.4의 8개 확인 항목 중 공개 링크·로그 마스킹(`TP-E-OPS-LOG-MASK`)·헬스체크(`/livez`, `/readyz`) 확인이 TP 열에서 생략됨. | [13-cutover.md](../../../docs/02-architecture/13-cutover.md#L60-L72) | `BE-36`의 `AC / TP`에 `TP-E-OPS-LOG-MASK`를 보태거나 완료 조건에 `13 §3.4` 전 항목 확인을 명시함. |
| `minor` | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L86) | `BE-33`에 48개 AC와 14개 TP(부하·성능, 반응형·접근성, 4개 브라우저·iOS 실기기, 한·영 i18n)가 집중되어 있으나 추정 공수가 `3–5` 인일로 다소 타이트함. | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L86), [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L217-L249) | 프런트 스택·화면 확정(승인 ②) 이후 `BE-33`의 E2E·부하 QA 공수를 재산정함을 비고에 명시함. |

---

## 3. 점검 목록 표

| 번호 | 점검 항목 | 판정 | 근거 및 확인 내용 |
| --- | --- | --- | --- |
| 1 | 12가 07 API, 08 DB, 09 인증(B-1), 10 관측·CI, 11 테스트 계획, 13 전환과 맞는지 (누락 기능·경로·테이블·전환 단계·CI 게이트 여부) | **통과** | 07 API 10개 리소스+OIDC B-1 경로, 08 DB 17개 테이블(문서용 SQL), 09 B-1 OP/RP·DEC-094·098, 10 CI 7단계·헬스(`/livez`, `/readyz`), 11 테스트 수준·PV 33개, 13 전환(사전 점검→리허설→동결·전환·개방→롤백·출시 후 관찰)이 모두 `BE-01`~`BE-37`에 매핑됨. |
| 2 | 이슈마다 완료 조건(AC/TP ID)과 병렬 가능 표시 여부, CSV 열·id 동기·`phase:설계` 여부 | **통과** | 40개 이슈 전부 완료 조건·AC/TP ID·병렬 여부(`가능`/`순차`) 보유. CSV 열(`id,title,area,depends_on,estimate,acceptance,labels`)과 40개 행의 ID·내용·순서가 Markdown과 완전 일치하며, 모든 행에 `phase:설계`가 적용됨. |
| 3 | Must AC 139개·PV 33개가 이슈 완료 조건(또는 명시적 보류)에 연결됐는지 | **통과** | [AC.md](../../../docs/01-planning/acceptance-criteria/AC.md)의 `### AC-` 제목 **139개**(기능 Must 109개 + 비기능 30개)와 [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L215-L249)의 **PV 33개**(PV-003~PV-035) 전부 누락 없이 연결됨. |
| 4 | 스파이크 성공 기준 측정 가능성 및 미존재 crate 단정 여부 | **통과** | `SPIKE-AUTH`는 4개 후보(`openidconnect` 4.1.0, `oauth2` 5.0.0, `jsonwebtoken` 12.0.0, `oauth-as` 1.1.0)의 공식 docs.rs/GitHub URL과 확인 시각(2026-11-26 22:28~22:29 KST)을 명시했고 백채널 미확인 사항은 `[확인 필요]`로 남김. `SPIKE-MD-ROUNDTRIP`은 2차 재열기 손실·오연결·권한 밖 노출 각 0건 및 실패 시 형식 2 임의 전환 금지를 명시함. (단, 실제 crate 존재·URL 응답은 오프라인 검토 환경상 `[미확인]`). |
| 5 | 프런트 자리만 잡혔는지, GitHub 이슈 생성 흔적이 없는지 | **통과** | `FE-PLACEHOLDER`("스택 미정, 디자인 완료 후")로 자리만 확보함. 작업 폴더 내 코드 작성·crate 설치 흔적(`Cargo.toml` 등) 없고, `12-work-breakdown.md` §8에 GitHub 이슈 생성은 승인 ④ 및 권한 필요로 명시됨. |
| 6 | 07~11·13·ADR 0004와 모순(B-2 잔존, 분할 업로드, 무손실 임의 전환 등) 여부 | **통과** | B-2 기각·B-1 채택, 8 MiB 분할 업로드 폐기·DEC-090 1 GiB 단일 요청 스트리밍, DEC-094 현재 기기 통합 로그아웃, DEC-098 정지 차단, 무손실 스파이크 실패 시 형식 2 임의 전환 금지 모두 모순 없이 일치함. |
| 7 | 열린 `[미확인]`을 결정으로 바꾸지 않았는지 | **통과** | `RB-017`, `GAP-016/018/025`, `Q-081/085/087/091/092`, `DM-002/004/006/007/009/010/011`, `CO-03`, 배포 호스트·IaC, AVAIL 공지, 23장 원문 부재 등 열린 `[미확인]` 항목을 모두 §7에 유지하고 추측으로 닫지 않음. |

---

## 4. 이슈·AC/PV 커버리지 상세

- **AC 139개 ([AC.md](../../../docs/01-planning/acceptance-criteria/AC.md#L38-L908))**: **빠진 ID 없음 (139/139 연결)**
  - 기능 Must AC 109개:
    - `AC-FR-AUTH-001-01`~`006-01` (22개): `BE-07`, `BE-08`, `BE-09`, `BE-11`, `BE-13`, `BE-31`, `BE-33`
    - `AC-FR-HOME-001-01`~`002-02` (4개): `BE-06`, `BE-14`, `BE-33`
    - `AC-FR-SHELL-001-01`~`003-09` (19개): `BE-12`, `BE-13`, `BE-14`, `BE-33`
    - `AC-FR-OSS-001-01`~`003-02` (9개): `SPIKE-MD-ROUNDTRIP`, `BE-30`, `BE-31`, `BE-32`, `BE-33`
    - `AC-FR-DRV-001-01`~`008-03` (39개): `SPIKE-MD-ROUNDTRIP`, `BE-15`~`BE-21`, `BE-24`, `BE-25`, `BE-31`, `BE-32`, `BE-33`
    - `AC-FR-ADM-001-01`~`004-04` (16개): `BE-06`, `BE-22`, `BE-23`, `BE-33`
  - 비기능 AC 30개:
    - `AC-NFR-PERF-*` (7개): `BE-16`, `BE-17`, `BE-28`, `BE-33`
    - `AC-NFR-SEC-*` (7개): `BE-08`, `BE-09`, `BE-11`, `BE-13`, `BE-18`, `BE-19`, `BE-21`, `BE-25`, `BE-29`, `BE-34`
    - `AC-NFR-AVAIL-*` (2개): `BE-37`
    - `AC-NFR-USAB-*` (3개): `BE-33`, `FE-PLACEHOLDER`
    - `AC-NFR-OPS-*` (6개): `BE-26`, `BE-27`, `BE-28`
    - `AC-NFR-COMP-*` (2개): `BE-33`, `FE-PLACEHOLDER`
    - `AC-NFR-I18N-*` (3개): `BE-14`, `BE-33`

- **PV 33개 ([11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L215-L249))**: **빠진 ID 없음 (33/33 연결, PV-003~PV-035)**
  - `12-work-breakdown.md` §6의 매핑 표와 §3 각 이슈의 `AC / TP` 열이 모두 일치함 (`BE-08`: PV-029, `BE-09`: PV-018, `BE-11`: PV-017·028, `BE-16`: PV-003, `BE-18`: PV-005, `BE-21`: PV-019·030, `BE-25`: PV-020, `BE-26`: PV-016, `BE-27`: PV-013·014·015·034, `BE-28`: PV-022·023·031·035, `BE-29`: PV-021, `BE-33`: PV-004·006~011·024~027·032·033, `BE-37`: PV-012).

---

## 5. 스파이크 기준 평가

### 1) `SPIKE-AUTH` ([spike-auth-library.md](../../../docs/02-architecture/spikes/spike-auth-library.md))
- **측정 가능성**:
  - **문서/API 검토**: 07 §Litpage B-1과 09 §4~5 계약 전 항목에 지원 판정·API 근거·담당 구성요소 연결, 라이선스·MSRV·전이 의존성·axum 0.8/tokio 1 빌드 결과 확인 — **측정 가능**.
  - **프로토콜 검증**: Google 로그인/취소, Discovery·JWKS, authorize·token·UserInfo 정상 성공 및 URI·PKCE·서명·클레임 오류 거부, 일회 코드 소비·갱신 회전 경합 시 중복 발급 **0건** — **측정 가능**.
  - **로그아웃 검증**: 두 기기에서 나루 시작·RP 시작 경로별 확인, 현재 기기 세션·웹소켓만 종료 및 다른 기기 유지, 잘못된 Logout Token 거부, 경로별 **30회**에서 전파 최댓값 **≤5초**·API p95 **≤2초** (PV-017·028) — **측정 가능**.
  - **보안 검토**: 고정 issuer·정확한 redirect URI, 일회성 state·nonce·verifier, 백엔드 HTTP 자동 redirect 비활성화, 유효 알고리즘 고정, 로그 자격 마스킹 교차 확인 — **측정 가능**.
- **crate 확인 및 제약**: `openidconnect` 4.1.0, `jsonwebtoken` 12.0.0, `oauth2` 5.0.0, `oauth-as` 1.1.0의 공식 URL과 확인 시각(KST)을 기재했고, 미확인 백채널 지원은 `[확인 필요]`로 두어 단정하지 않음.

### 2) `SPIKE-MD-ROUNDTRIP` ([spike-md-csv-roundtrip.md](../../../docs/02-architecture/spikes/spike-md-csv-roundtrip.md))
- **측정 가능성**:
  - **말뭉치 범위**: [ADR 0004](../../../docs/decisions/0004-auth-idp-litpage.md#L107-L113)의 5개 유형(일반 문서·하위 페이지, 리치텍스트·첨부, 인라인/전체 페이지 DB·행 페이지, 댓글, 권한 차이 문서/속성) 전부 포함 + CSV 경계값(한글·따옴표·쉼표·내부 줄바꿈) 추가 — **완전 일치**.
  - **측정 절차**: 원본 SQLite 레코드 접근이 차단된 새 환경에서 1차 재열기 → 유형별 대표 편집 후 2차 재열기 → 구조 diff·해시·역매핑 기계적 비교 및 UI 육안 확인 — **측정 가능**.
  - **합격/실패 기준**: 두 차례 재열기에서 편집 불가·누락·변형·오연결·권한 밖 노출 각 **0건**이 합격, 1건이라도 발생 시 실패, 미완료 시 합격 보류. 실패 시 호배님께 보고 후 재결정하며 **형식 2(네이티브 스냅샷·SQLite) 임의 전환 금지**를 명시함 — **명확하고 측정 가능**.

---

## 6. 12와 07~11·13·ADR 사이 불일치

- **주요 불일치(blocking/major) 없음.**
- 위 §2 설계 결함 표에 기록한 `minor` 4건(`SPIKE-AUTH` 문서 vs 12 표의 `TP-C-OIDC-KEYS` 표기 차이, `BE-24`의 공유/링크 연계 검증 시점, `BE-36`의 `TP-E-OPS-LOG-MASK` 표기 생략, `BE-33`의 QA 공수 재산정 필요성) 외에 07~11·13·ADR 0003/0004와의 계약·결정 충돌은 확인되지 않음.

---

## 7. 검토하지 못한 부분과 이유

1. **Git 이력·브랜치·커밋(`2f1db92`, `feature/NARU-94-architecture`) 직접 검증 (`[미확인]`)**: 현재 작업 폴더([/Users/banghobae/.naru-orch/review/arch-wbs-12-spikes-review-01](file:///Users/banghobae/.naru-orch/review/arch-wbs-12-spikes-review-01))가 `.git` 디렉터리가 없는 읽기 전용 사본이므로 `git status`·`git log`·`git diff`를 통한 커밋 해시 및 변경 파일 이력 대조를 수행하지 못함. (파일 수정 시각으로 04~11·13·ADR 문서가 변경되지 않았음만 간접 확인함).
2. **외부 crate 레지스트리 및 문서 URL 실존·버전 실시간 검증 (`[미확인]`)**: 읽기 전용·네트워크 미사용 검토 제약으로 `docs.rs` 및 GitHub 저장소 URL(`openidconnect` 4.1.0, `oauth2` 5.0.0, `jsonwebtoken` 12.0.0, `oauth-as` 1.1.0)에 직접 접속해 버전·릴리스 일자·라이선스를 재확인하지 못함.
3. **설계서 23장 원문 (`[미확인]`)**: `12-work-breakdown.md` §7과 동일하게 저장소 내 설계서 23장 원문을 찾지 못해 요청문에 제시된 12번 산출물 정의를 기준으로 검토함.
4. **프런트엔드 상세 작업 분해 (`[미확인]`)**: 디자인 시안 확정 및 승인 ② 이전 단계이므로 `FE-PLACEHOLDER` 자리만 검토함.