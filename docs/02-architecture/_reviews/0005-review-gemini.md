<!-- naru-orch job=P2-16-adr-0005-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=745fae81-7b24-4c2e-a2e7-9d3c3880c818 saved=2026-11-27T08:43:17+09:00 -->

# ADR 0005 프런트 스택 초안 및 12 minor 4건 반영 검토 결과

## 1. 요약

| 대상 문서 | blocking | major | minor | 합계 |
| --- | ---: | ---: | ---: | ---: |
| [0005-frontend-stack.md](../../../docs/decisions/0005-frontend-stack.md) | 0 | 0 | 0 | 0 |
| [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md) | 0 | 0 | 0 | 0 |
| [12-issues.csv](../../../docs/02-architecture/12-issues.csv) | 0 | 0 | 0 | 0 |
| **총계** | **0** | **0** | **0** | **0** |

- 후보 4개(`React SPA + Vite`, `Next.js`, `SvelteKit`, `Rust/WASM(Leptos)`), 비교 기준 11개, 디자인 완료 후 확인 항목 7개로 구성되어 있으며, 승자(결정·채택·기각)를 지정하지 않은 **Proposed** 상태다.

---

## 2. 발견 표

남은 blocking/major 없음 (minor 0건).

---

## 3. 점검 목록

| 번호 | 점검 항목 | 판정 | 한 줄 근거 |
| --- | --- | --- | --- |
| 1 | ADR 상태 Proposed 및 승자 미결정·구분 여부 | **충족** | [0005-frontend-stack.md](../../../docs/decisions/0005-frontend-stack.md#L7)에서 상태를 `Proposed`로 두고 승인 ② 대기를 명시했으며, 비교표와 §6에서도 승자나 확정 결정을 적지 않았다. |
| 2 | 실재 후보 최소 3개, 성격·Litpage(React)·B-1 설명, 버전 미단정 | **충족** | [0005-frontend-stack.md §3](../../../docs/decisions/0005-frontend-stack.md#L37-L44)에 실재 프레임워크 4개(`React SPA + Vite`, `Next.js`, `SvelteKit`, `Rust/WASM(Leptos)`)의 렌더링·배포 성격과 Litpage(React)·B-1 관계를 적었고, 버전은 모두 `[확인 필요]`로 두었다. |
| 3 | 비교 기준 표 필수 기준 포함 및 승자 미지정 여부 | **충족** | [0005-frontend-stack.md §4](../../../docs/decisions/0005-frontend-stack.md#L46-L65)에 필수 9개 기준(토큰·다크 모드, 접근성, 반응형·모바일, 쿠키·CSRF, 업로드 UX·DEC-090, 테스트·CI, 배포 형태, 팀 학습 비용, Litpage B-1)과 성능·한·영 i18n까지 총 11개 기준을 포함하고 사실·확인 사항·불확실성만 기록했다. |
| 4 | 「디자인 완료 후 확인할 것」의 종속성 타당 여부 | **충족** | [0005-frontend-stack.md §5](../../../docs/decisions/0005-frontend-stack.md#L66-L76)의 7개 항목(오버레이 포커스, 1 GiB 진행·취소, 계정 테마 적용 범위, 정적 배포 가능 여부, 프런트 시험·CI 게이트, Litpage 공통 자산, 성능 측정 경계) 모두 시안·프로토타입·화면 데이터 목록 완료 전에는 닫을 수 없는 항목이다. |
| 5 | 입력 출처(07 v0.4, 09 B-1, 10, 11, DEC-084·101·102, 성능, 디자인 v0.3) 일치 여부 | **충족** | [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L5)(v0.4), [09-auth.md](../../../docs/02-architecture/09-auth.md#L5)(v0.2, B-1), [10-observability-ci.md](../../../docs/02-architecture/10-observability-ci.md#L101), [11-test-plan.md](../../../docs/02-architecture/11-test-plan.md#L319-L327), [NFR.md](../../../docs/01-planning/nfr/NFR.md#L49-L60), [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L100-L102)와 일치하며 디자인 입력(`04bc090`, `adda6ef`, SHA-256 앞 16자 `66cd7dd0073f0f58`, 후속 커밋 차이)도 요청문과 맞게 기재됐다. |
| 6 | `FE-PLACEHOLDER` 연결, 12 minor 4건 반영, CSV/MD 정합성 | **충족** | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L52-L91)과 [12-issues.csv](../../../docs/02-architecture/12-issues.csv#L1-L41) 모두 minor 4건과 `FE-PLACEHOLDER`가 반영됐고 40개 이슈의 ID·열·행이 100% 일치한다. |
| 7 | 비대상 문서 미수정, B-2·8 MiB·추측 단정·비밀 값 부재 여부 | **충족** | 파일 수정 시각 기준 2026-11-27 갱신 파일은 검토 대상 3건뿐이며(`04`~`11`·`13`·`0003`·`0004`·`spikes/`·`01-planning/`은 2026-11-26 이하, `03-ui-design/`은 사본 내 부재), B-2 잔존·8 MiB 분할 업로드·미확인 단정·비밀 값 기재가 없다. |

---

## 4. 12 minor 4건과 FE-PLACEHOLDER 반영 여부

| 항목 | 판정 | 반영 근거 |
| --- | --- | --- |
| `SPIKE-AUTH` (`TP-C-OIDC-KEYS`) | **충족** | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L52)과 [12-issues.csv](../../../docs/02-architecture/12-issues.csv#L2)의 `SPIKE-AUTH` `AC / TP` 열에 `TP-C-OIDC-KEYS`가 추가됐다. |
| `BE-24` (선행 유지 및 연계 시점) | **충족** | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L77)에서 선행 `BE-15`를 유지([12-issues.csv](../../../docs/02-architecture/12-issues.csv#L27) 동일)하고 완료 조건에 `공유·공개 링크 차단의 실제 연계는 BE-21 또는 BE-33과 통합 확인한다.`를 명시했다. |
| `BE-36` (`TP-E-OPS-LOG-MASK`·13 §3.4 전 항목) | **충족** | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L89)과 [12-issues.csv](../../../docs/02-architecture/12-issues.csv#L39)에 `TP-E-OPS-LOG-MASK`가 추가됐고 완료 조건에 `13 §3.4 전 항목(공개 링크·로그 마스킹·헬스체크 /livez·/readyz 포함)` 확인을 명시했다. |
| `BE-33` (공수 유지 및 재산정 명시) | **충족** | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L86)과 [12-issues.csv](../../../docs/02-architecture/12-issues.csv#L36)에서 추정을 `3–5` 인일로 유지하고 완료 조건에 `프런트 스택·화면 확정(승인 ②) 이후 E2E·부하 QA 공수를 재산정한다.`를 명시했다. |
| `FE-PLACEHOLDER` (ADR 0005 연결·40개 ID 일치) | **충족** | [12-work-breakdown.md](../../../docs/02-architecture/12-work-breakdown.md#L91) 및 §4 의존성 흐름도([L126](../../../docs/02-architecture/12-work-breakdown.md#L126))에서 `ADR 0005(Proposed)` 참조와 승인 ② 확정을 연결했고, [12-issues.csv](../../../docs/02-architecture/12-issues.csv#L2-L41)와 40개 이슈 ID·필드가 일치한다. |

---

## 5. 남은 [미확인] 목록

- **ADR 0005 내 열린 `[미확인]`·`[확인 필요]`**:
  - 후보 4개 프레임워크의 버전(`[확인 필요]`) 및 팀의 후보별 숙련도(`[미확인]`) ([0005-frontend-stack.md §3·§6](../../../docs/decisions/0005-frontend-stack.md#L39-L44)).
  - Next.js 선택 시 Litpage 서버 의존 컴포넌트 공유 범위(`[미확인]`) ([0005-frontend-stack.md §4](../../../docs/decisions/0005-frontend-stack.md#L60)).
  - 디자인 완료 후 확인할 것 7개 항목(화면 전환·오버레이 포커스, 1 GiB 업로드 진행·취소, 계정 테마 적용 범위, 정적 배포 가능 여부, 프런트 시험·CI 게이트, Litpage RP 공통 자산, 화면 성능 측정 경계) ([0005-frontend-stack.md §5](../../../docs/decisions/0005-frontend-stack.md#L66-L76)).
  - `RB-017`(Cloudflare 프록시 경로·본문 한도와 1 GiB 단일 요청 양립), `GAP-018`(브라우저 '최신' 정의·iOS 타 브라우저 취급), `DM-002/004/006/007/009/010/011` 화면 계약, 터치 기기 대체 미리보기, 로그인 전 언어·테마 적용 방식, 화면별 WCAG 점검 세부, 기획 성능 표본·기간·측정 지점 및 오류율 분모·집계 창, 배포 호스트·라우팅·시험 도구·러너·CI 게이트 세부 ([0005-frontend-stack.md §6](../../../docs/decisions/0005-frontend-stack.md#L82-L85)).
- **12 작업 분해 내 기존 열린 `[미확인]`** (`[12-work-breakdown.md §7](../../../docs/02-architecture/12-work-breakdown.md#L177-L188)`): `RB-017`, `GAP-016/018/025`, `Q-081/085/087/091/092`, `DM-002/004/006/007/009/010/011`, 인증·Litpage 구현/실측, 배포·운영(호스트·IaC·시드·AVAIL), 설계서 23장 원문.

---

## 6. ADR 0005와 07·09·10·11·12·ADR 0004 사이 불일치

불일치 없음.
- B-1(나루 얇은 OIDC OP·Litpage 새 RP), DEC-090(1 GiB 단일 요청 스트리밍, 8 MiB 분할 업로드 없음), DEC-094(현재 기기 통합 로그아웃), DEC-098(정지 차단), DEC-101·113(계정별 테마, Litpage 제외), DEC-102(WCAG 2.1 AA), DEC-084(터치 마우스 올림 썸네일 생략)와 `12-work-breakdown.md`의 `FE-PLACEHOLDER`·`BE-33` 재산정 조건이 모두 정합하다.

---

## 7. 검토하지 못한 부분과 이유

1. **Git 커밋 이력 및 `git diff` 직접 대조 (`[미확인]`)**: 현재 작업 폴더가 `.git` 디렉터리가 없는 읽기 전용 사본이므로(`git status` 실행 시 `fatal: not a git repository`), `2f1db92`·`75cf6fd` 및 비대상 파일 미수정 여부를 Git 이력으로 직접 검증하지 못하고 파일 수정 시각(`ls -laT`)으로만 간접 확인했다.
2. **디자인 시스템 원문 및 `tokens.json` SHA-256 직접 대조 (`[미확인]`)**: `docs/03-ui-design/` 원문과 디자인 워크트리가 이 사본 밖에 있어, `04bc090`·`adda6ef` 커밋 내용 및 `tokens.json` 해시(`66cd7dd0073f0f58`)를 직접 열어 확인하지 못하고 작업 요청문 기재 내용과의 일치 여부만 확인했다.
3. **프런트엔드 프레임워크 최신 버전 실시간 확인 (`[미확인]`)**: 네트워크·패키지 조회 금지 규칙에 따라 4개 후보의 실제 최신 버전을 외부에서 조회하지 않았다.