<!-- naru-orch job=P2-6-rebaseline-2f1db92-recheck-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=f9d9d015-c0af-4496-9133-09f5fe031d30 saved=2026-11-26T20:26:06+09:00 -->

## 1. 요약

설계 문서 4종([04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md) v0.3, [05-architecture.md](../../../docs/02-architecture/05-architecture.md) v0.3, [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md) v0.3, [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md) 개정 1)을 새 기획 기준(**develop `2f1db92`**, PR #99, 라운드 16~19, `DEC-081~121`)으로 재검토한 결과다.

| 대상 문서 | blocking | major | minor | 소계 |
|---|---:|---:|---:|---:|
| [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md) | 0 | 0 | 0 | 0 |
| [05-architecture.md](../../../docs/02-architecture/05-architecture.md) | 0 | 0 | 0 | 0 |
| [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md) | 0 | 0 | 0 | 0 |
| [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md) | 0 | 0 | 0 | 0 |
| **총계** | **0** | **0** | **0** | **0** |

- **이전 22건(`RB-001~022`) 처리 현황**:
  - **해소**: **20건** (`RB-001~016`, `RB-018~021`)
  - **`[미확인]` 유지(기획 결정 대기)**: **1건** (`RB-017`)
  - **범위 밖(기획 문서 정리)**: **1건** (`RB-022`)
  - **잔존/부분**: **0건**

---

## 2. 발견 표

**남은 blocking / major / minor 결함 없음.**

---

## 3. 이전 RB-001~022 처리 점검 표

| 이전 ID | 상태 | 한 줄 근거 |
|---|---|---|
| RB-001 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L104) §3(`NFR-SEC-002`·`006`), §4.4, PV-018·029에서 폐지된 `DEC-027` 인용과 `T+1시간 API 200`/`기존 세션 Litpage 사용`을 제거하고 토큰 갱신 거부·Litpage 진입 차단·유휴 7일/절대 30일·`Q-087 [미확인]`을 반영함. |
| RB-002 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L127-L135) §3(`NFR-PERF-002`) 및 §4.1에서 8 MiB 분할·재개(`PV-002`)와 24시간 조각 정리를 삭제하고 단일 요청 스트리밍·중단 시 처음부터 재전송(`DEC-090`)으로 수정함. |
| RB-003 | 해소 | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L133-L162) §6.1, §7(`미확정 임시 파일 정리`), §8(`파일 저장소` 포트)을 단일 요청 스트리밍 업로드와 실패 시 임시 파일 정리 기준으로 재설계함. |
| RB-004 | 해소 | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L137-L142) §5(`드라이브 업로드`, `만료·정리 작업`)와 §8(`naru-http`)을 단일 요청 스트리밍·미확정 임시 파일 정리·처음부터 재전송 기준으로 수정함. |
| RB-005 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L131) §3(`NFR-PERF-002`)과 §4.1에서 개별·폴더 업로드 모두 0바이트 파일 거부(`DEC-107`)로 수정함. |
| RB-006 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L127-L132) §3·§4.1에서 `1,073,741,824 B`를 `[기획] DEC-086`으로 승격(`PV-001` 제거)하고 폴더 초과 파일 제외·안내(`DEC-106`), 이름 충돌 `(1)`, `(2)` 부여(`DEC-108`)를 반영함. |
| RB-007 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L195-L204) §3(`NFR-SEC-004`), §4.5, PV-020에서 `AS-009`(30×24시간 UTC)를 제거하고 달력 날짜 30일·휴지통 시계 지속(`DEC-096`), `Q-085 [미확인]`을 반영함. |
| RB-008 | 해소 | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L246-L247) §7·§11에서 `AS-009`와 탈퇴 보관 중 휴지통 타이머 `[미확인]`을 제거하고 달력 날짜 30일(`DEC-096`)과 `Q-085 [미확인]`을 반영함. |
| RB-009 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L219) §3(`NFR-OPS-001`), §4.7, `AS-013`을 회원 정보·드라이브 파일만 백업(공유·링크·설정 제외, `DEC-091`)과 30일 자동 만료·복원 시 삭제 재적용(`DEC-083`)으로 수정함. |
| RB-010 | 해소 | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L251) §7에 `DEC-083`과 함께 백업 범위가 회원 정보·드라이브 파일만(공유·링크·설정 제외, `DEC-091`)임을 명시함. |
| RB-011 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L215) §3(`NFR-AVAIL-001`), §4.6, PV-012를 미리 알린 점검·외부 장애 제외 및 출시 후 한 달 관찰만 수행(`DEC-089`)으로 수정함. |
| RB-012 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L120) §3(`NFR-I18N-002`), §4.8, PV-026에 로그인 화면 언어 전환, 로그인 후 계정 언어 우선, Litpage 언어 동기화(`DEC-100`·`110`)를 반영함. |
| RB-013 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L108-L116) §3·§4·§8에 신설 NFR 5종(`SEC-006`, `USAB-002`, `USAB-003`, `OPS-003`, `OPS-004`)을 모두 반영해 23개 체제로 맞춤. |
| RB-014 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L99-L106) §3·§4·§6에서 `DEC-084`·`087`·`088`·`094`·`095`·`099`·`109`·`111`·`114`·`117`을 `[기획]`으로 승격해 반영함. |
| RB-015 | 해소 | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L255-L273) §9에 테마 적용 범위(`DEC-113`, Litpage 제외)를, §7·§8에 감사 기록(`DEC-104`, `Q-091`)과 저장 용량 경보(`DEC-105`, `Q-092`) 책임을 반영함. |
| RB-016 | 해소 | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L140-L143) §5(`회원 상태`, `서비스 노출 관리`, `운영`)와 §8에 감사 기록(`DEC-104`, `Q-091`)과 저장 용량 경보(`DEC-105`, `Q-092`) 책임을 반영함. |
| RB-017 | `[미확인]` 유지 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L135), [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L74), [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L188) 모두 `CO-02` Cloudflare 본문 한도와 `DEC-090` 1GB 단일 업로드 충돌 여부를 `[미확인] · 기획 결정 대기 중`으로 유지하며 단일 요청 스트리밍 기준을 유지함. |
| RB-018 | 해소 | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L12-L39) §1·§1.1·§5에서 기준선을 `2f1db92`, NFR v1.3, FRD/BR v1.4, `DEC-081~121`, `Q-081·085·087·091·092`로 갱신하고 해소된 GAP를 정리함. |
| RB-019 | 해소 | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L13-L43) §1·§1.1·§6.4·§10에서 기준선 표기를 `2f1db92`·DEC 기준으로 갱신하고 §6.4에 `Q-087 [미확인]`을 병기함. |
| RB-020 | 해소 | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L13-L43) §1·§1.1·§9에서 기준선 표기와 추적 표의 GAP/DEC 참조를 `2f1db92` 기준으로 갱신함. |
| RB-021 | 해소 | [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md#L7-L25) 개정 1(rebaseline `2f1db92`)에서 `GAP-004` 잔존 문구를 `DEC-086`(`1,073,741,824 B`)으로 갱신하고 기존 스택 결정은 유지함. |
| RB-022 | 범위 밖(RB-022) | 기획 문서 헤더·`DEC-081` 표기 정리는 기획 측 범위로, 설계 문서가 이를 고치지 않은 것은 정상임. |

---

## 4. 남은 `[미확인]` 목록

- **열린 질문(`open-questions.md`)**:
  - **Q-081**: 사업자·운영자 정보 표시 의무 및 운영 로그·감사 기록의 법적 적정성(정식 배포 전 확인).
  - **Q-085**: 달력 날짜 기준 30일(`DEC-096`)의 시간대·경계 시각·시작일 산정.
  - **Q-087**: 정지된 회원의 이미 연 세션이 토큰 갱신 때 차단되기까지의 최대 시간.
  - **Q-091**: 감사 기록(`DEC-104`) 항목·보관 기간 및 운영 로그 30일 정책 적용 여부.
  - **Q-092**: 전체 저장 용량 운영 경보(`DEC-105`) 기준 수치·수신 대상·방법.
- **미결 GAP·기획 결정 대기**:
  - **RB-017**: `CO-02`(Cloudflare) 프록시 경로·본문 한도와 `DEC-090` 1GB 단일 업로드 충돌 여부(기획 결정 대기 중).
  - **GAP-016**: 기본 보안선(HTTPS·쿠키·업로드·레이트 리밋). `04` §4.9 및 `PV-022·023`의 설계 자체 기본선(제안값)으로 유지 중.
  - **GAP-018**: `NFR-COMP-002` "최신" 브라우저 정의 및 iOS 타 브라우저 취급(`PV-025` 제안값 유지).
  - **GAP-025**: Litpage 자동 저장 지연·재시도·실패 정의·1GB 한도 적용.
- **설계 이관·후속 ADR 대기(`04` §5, `05` §11, `06` §10)**:
  - `[ADR 대기]`: 인증/IdP·세션(09 예정), 파일 저장소, 잡 러너, 프런트엔드 스택.
  - 기타 `[미확인]`: 화면용 콘텐츠 형식(`DEC-095·109`), 로그인 전 언어·테마 임시 저장/적용 방식(`DEC-110·113`), `WCAG 2.1 AA` 화면별 세부 범위·검증 방식(`DEC-102`), 정지 상태에서의 탈퇴 실행 가능 여부(`DEC-114`), 충돌 사본 소유권 처리(`DEC-112`), 성공 지표 집계 보관 기간·항목(`DEC-085`), `sqlx::test` 실제 PostgreSQL 실행 및 동시 부하·프록시 실측(`0003-backend-stack.md`).

---

## 5. 04·05·06·ADR 0003 사이 불일치

**불일치 없음.**
- 문서 번호 매핑(`05`=아키텍처, `06`=크레이트 구조, `06F`=스택 타당성 검토, `07`=API 계약 예정, `09`=인증/IdP·세션 예정)이 `04` §8.2, `05` §1.2, `06` §1.2에서 일치한다.
- 업로드 한도(`1,073,741,824 B`), `0바이트` 거부, 단일 요청 스트리밍(`DEC-090`), `PV-003`(≤64 MiB), `RB-017 [미확인]`이 4개 문서 전반에 일관되게 반영되어 있다.
- 정지·세션 만료(`DEC-092·098`, `Q-087 [미확인]`), 달력 30일(`DEC-096`, `Q-085 [미확인]`), 백업 범위·만료(`DEC-083·091`), 감사·용량 경보(`DEC-104·105`, `Q-091·092 [미확인]`)가 `04`·`05`·`06` 사이에 모순 없이 연결되어 있다.

---

## 6. 검토하지 못한 부분과 이유

- [AC.md](../../../docs/01-planning/acceptance-criteria/AC.md), [FRD.md](../../../docs/01-planning/frd/FRD.md)(1~199행, 301~427행), `UF.md`, `PRD.md`, `matrix.csv`, `round-18.md`, `round-19.md`, `carry-over/README.md`, [06F-stack-feasibility.md](../../../docs/02-architecture/06F-stack-feasibility.md) 본문(§1 버전 표기만 확인): 이번 재검토는 설계 문서 4종과 [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md)(`DEC-081~121`), [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md), [NFR.md](../../../docs/01-planning/nfr/NFR.md), [BR.md](../../../docs/01-planning/business-rules/BR.md), `FRD.md`(§7~8), [rebaseline-2f1db92-gemini.md](../../../docs/02-architecture/_reviews/rebaseline-2f1db92-gemini.md)를 중심으로 대조해 위 문서들의 전체 행 단위 열람은 생략했다.
- `.env*`, 비밀 파일, `.docx`, 이미지 파일 및 git 쓰기·이력 조작: 읽기 전용 작업 규칙에 따라 읽거나 실행하지 않았다.