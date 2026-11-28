<!-- naru-orch job=P2-6-rebaseline-2f1db92-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=7e362794-5a34-4c9f-9876-c0cb2a83d6a1 saved=2026-11-26T20:00:20+09:00 -->

## 1. 요약

새 기획 기준선(**develop `2f1db92`**, PR #99, 라운드 16~19, `DEC-081~121`)으로 설계 문서 4종([04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md), [05-architecture.md](../../../docs/02-architecture/05-architecture.md), [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md), [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md))을 재대조한 결과다.

| 대상 문서 | blocking | major | minor | 소계 |
|---|---:|---:|---:|---:|
| [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md) | 3 | 8 | 1 | 12 |
| [05-architecture.md](../../../docs/02-architecture/05-architecture.md) | 1 | 3 | 1 | 5 |
| [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md) | 1 | 1 | 1 | 3 |
| [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md) | 0 | 0 | 1 | 1 |
| 기획 문서(되돌릴 항목) | 0 | 0 | 1 | 1 |
| **총계** | **5** | **12** | **5** | **22** |

- **기획으로 되돌릴 항목 수**: **2건** (`RB-017`, `RB-022`)
- **핵심 결론**:
  - `04`는 정지 회원·세션(`DEC-092`, `DEC-098`)과 업로드(`DEC-090`, `DEC-107`)에서 새 기준과 정면 충돌한다.
  - `05`·`06`은 정지·세션(`DEC-092`, `DEC-098`)과 백업 만료(`DEC-083`), 테마·접근성(`DEC-101`, `DEC-102`)을 이미 반영했으나, 업로드 분할·재개(`DEC-090` 충돌), 달력 30일(`DEC-096`), 백업 범위(`DEC-091`), 감사 기록(`DEC-104`), 용량 경보(`DEC-105`), 기준선 표기(`4b66d1d` → `2f1db92`) 갱신이 필요하다.
  - `ADR 0003`의 기술 스택 선택 자체는 새 기획과 모순되지 않는다.

---

## 2. 발견 표

| ID | 심각도 | 문서·위치 | 새 기준 근거(파일·ID) | 고칠 내용 | 기획으로 되돌릴 것인가 |
|---|---|---|---|---|---|
| RB-001 | blocking | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L107) (§3 L107, §4.4 L182-195, PV-018 L321, PV-029 L332, §8.1 L371) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L103) `DEC-092`·`DEC-098`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L112-L145) `NFR-SEC-002`·`006`, [AC.md](../../../docs/01-planning/acceptance-criteria/AC.md#L145-L169) `AC-FR-AUTH-005-02`·`04`·`05` | 폐지된 `DEC-027`("로그아웃할 때까지 사용") 인용 및 `GAP-012`("세션 수명 부재") 제거. PV-018·PV-029의 "기존 세션으로 Litpage 진입·사용 가능"과 "T+1시간 API 200"을 **토큰 갱신 거부·Litpage 진입 차단** 검증으로 수정(유휴 7일·최대 30일은 [기획] `NFR-SEC-006`으로 승격, 갱신 최대 지연은 `Q-087 [미확인]` 명시). | 아니오 |
| RB-002 | blocking | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L103) (§3 L103, §4.1 L127-138·L145, PV-002 L305) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L101) `DEC-090`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L84) `NFR-PERF-002`, [AC.md](../../../docs/01-planning/acceptance-criteria/AC.md#L439-L443) `AC-FR-DRV-003-05` | 8 MiB 분할·재개 업로드(`PV-002`), 미완료 조각 24시간 정리, 중단 후 재개 시험 및 mermaid 흐름도 삭제. "한 번에 올리며 끊기면 처음부터 다시 업로드(분할·이어 올리기 없음)"로 수정. | 아니오 |
| RB-003 | blocking | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L131-L167) (§6.1 L131-167, §7 L254, §8 L266) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L101) `DEC-090`, [FRD.md](../../../docs/01-planning/frd/FRD.md#L271) `FR-DRV-003` | §6.1 "분할 업로드와 재개"(8 MiB 청크·24시간 업로드 세션·재전송 루프) 전체를 단일 요청 스트리밍 업로드 흐름으로 재설계. §7 `미완료 업로드 조각 정리`와 §8 파일 저장소 포트의 `분할·재개/조각` 책임도 단일 업로드 실패 시 미확정 임시 파일 정리로 수정. | 아니오 |
| RB-004 | blocking | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L134) (§5 L134·L138) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L101) `DEC-090`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L84) `NFR-PERF-002` | `드라이브 업로드` 모듈의 `청크 중복, 재개` 및 `PV-002` 책임과 `만료·정리 작업`의 `업로드 조각` 정리를 단일 요청 스트리밍 업로드 기준으로 수정. | 아니오 |
| RB-005 | blocking | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L142) (§3 L103, §4.1 L142) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L118) `DEC-107`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L84) `NFR-PERF-002`, [AC.md](../../../docs/01-planning/acceptance-criteria/AC.md#L451-L456) `AC-FR-DRV-003-07` | "0바이트 파일 허용 여부 기획에 없음. 제안은 허용"을 **개별·폴더 업로드 모두 0바이트 파일 업로드 차단**([기획] `DEC-107`)으로 수정. | 아니오 |
| RB-006 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L103) (§3 L103, PV-001 L304) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L97) `DEC-086`·`106`·`108`, [BR.md](../../../docs/01-planning/business-rules/BR.md#L207) `BR-024` | `1,073,741,824 B` 한도를 `PV-001`에서 `[기획] DEC-086`으로 승격. 누락된 **폴더 업로드 중 초과 파일만 제외·안내(`DEC-106`)** 및 **동일 이름 충돌 시 `(1)`, `(2)` 번호 부여(`DEC-108`)** 검증 추가. | 아니오 |
| RB-007 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L109) (§3 L109, §4.5 L200-212, PV-020 L323, AS-009 L352) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L107) `DEC-096`, [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L21) `Q-085` | "30일 = 30×24시간(UTC), 달력 기준 아님(`AS-009`)"을 **달력 날짜 기준(`DEC-096`)**으로 수정하고, 시간대·경계 시각·시작일 산정은 **`Q-085 [미확인]`**으로 유지. 탈퇴 보관 중 휴지통 시계 계속 진행 반영(`GAP-021` 일부 해소). | 아니오 |
| RB-008 | major | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L252-L253) (§7 L252-253, §11 L292) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L107) `DEC-096`, [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L21) `Q-085` | 휴지통·탈퇴 30일의 `AS-009`(30×24시간) 판정을 달력 날짜 기준(`DEC-096`) 및 `Q-085 [미확인]`으로 수정. §11의 탈퇴 보관 중 휴지통 타이머 `[미확인]` 표기 제거. | 아니오 |
| RB-009 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L356) (§3 L113, AS-013 L356) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L94) `DEC-083`·`DEC-091`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L183) `NFR-OPS-001` | `AS-013`("DB와 파일 스토리지 전체: 회원 정보·파일·공유·링크·설정")을 **회원 정보와 드라이브 파일만(공유·링크·설정 제외, `DEC-091`)**으로 수정하고, 30일 자동 만료·복원 시 삭제 재적용을 `[기획] DEC-083`으로 반영. | 아니오 |
| RB-010 | major | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L259) (§7 L259) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L102) `DEC-091`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L183) `NFR-OPS-001` | 백업 설명에 `DEC-083` 외에 **백업 범위가 회원 정보와 드라이브 파일만(공유·링크·설정 제외, `DEC-091`)**임을 명시. | 아니오 |
| RB-011 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L111) (§3 L111, PV-012 L315) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L100) `DEC-089`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L151) `NFR-AVAIL-001` | `PV-012`의 "계획 점검도 중단에 포함" 및 "출시 전 스테이징 중단 시간 측정"을 **미리 알린 점검·외부 장애 제외, 출시 전 별도 검증 없이 출시 후 한 달 관찰만(`DEC-089`)**으로 수정. | 아니오 |
| RB-012 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L118) (§3 L118, PV-026 L329) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L111) `DEC-100`·`DEC-110`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L236) `NFR-I18N-002` | "로그인 전 전환 UI는 기획에 없어 두지 않으며..."를 **로그인 화면 언어 전환 제공, 로그인 후 계정 언어 우선, Litpage 화면도 나루 언어에 맞춤(`DEC-100`, `DEC-110`)**으로 수정. | 아니오 |
| RB-013 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L96) (§3·§4·§8 전반) | [NFR.md](../../../docs/01-planning/nfr/NFR.md#L56-L64) `NFR-SEC-006`, `NFR-USAB-002`·`003`, `NFR-OPS-003`·`004` | NFR 18개 → 23개로 신설된 5개 항목(`SEC-006`, `USAB-002` 테마/Litpage 제외, `USAB-003` WCAG 2.1 AA, `OPS-003` 감사 기록/`Q-091`, `OPS-004` 용량 경보/`Q-092`)을 §3·§4·§8에 추가. | 아니오 |
| RB-014 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L102) (§3 L102·104·105·106·108·109, §6 PV 다수) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L95-L128) `DEC-084`·`087`·`088`·`094`·`095`·`099`·`109`·`111`·`114`·`117` | 기획 확정 항목을 `[제안값]`/`미정`으로 유지 중: 동시 20명=60초 활성 세션·오류율 0.1%·80/100명 경보만(`DEC-088`), p95·최초 생성/Google 제외·Litpage 포함(`DEC-087`), 터치 썸네일 생략(`DEC-084`), 현재 기기 로그아웃(`DEC-094`), 다운로드 금지 원본 미전송(`DEC-095`·`109`), 불가 링크 단일 안내(`DEC-117`), 탈퇴 보관 중 보기만/받은 공유 즉시 회수/정지 복구·유지(`DEC-099`·`111`·`114`). | 아니오 |
| RB-015 | major | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L273) (§9 L273, §7·§8 전반) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L115-L124) `DEC-104`·`105`·`113` | §9에 **`DEC-113`(테마는 나루·법적 문서에 적용, Litpage 미적용)** 보완. 관리자 감사 기록(`DEC-104`, `Q-091 [미확인]`) 및 저장 용량 경보(`DEC-105`, `Q-092 [미확인]`)의 아키텍처 책임 반영. | 아니오 |
| RB-016 | major | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L137-L138) (§5 L137-138) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L115-L116) `DEC-104`·`105`, [NFR.md](../../../docs/01-planning/nfr/NFR.md#L195-L207) `NFR-OPS-003`·`004` | `회원 상태`/운영 모듈 책임에 감사 기록(`DEC-104`, `Q-091 [미확인]`) 및 전체 저장 용량 경보(`DEC-105`, `Q-092 [미확인]`) 반영. | 아니오 |
| RB-017 | major | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L144) (§4.1 L144, GAP-005 L266; [05 §3](../../../docs/02-architecture/05-architecture.md#L72)) | [NFR.md](../../../docs/01-planning/nfr/NFR.md#L84) `NFR-PERF-002`(`DEC-090`), [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L93) `DEC-082` | `DEC-090`이 분할·이어 올리기를 금지하고 단일 요청 업로드만 허용했으나, `CO-02`(Cloudflare) 프록시를 경유하고 본문 한도가 1GB 미만(예: 무료/Pro 100 MB, 플랜 `[미확인]`)이면 1GB 단일 업로드가 불가할 수 있음. | 예 (`CO-02` 프록시 경유 시 `DEC-090`과 `NFR-PERF-002`가 양립 불가하므로 프록시 우회 vs 분할 허용 확인 필요) |
| RB-018 | minor | [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md#L12) (§1 L12·L28-37, §5 L262-296) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L92-L132) `DEC-081~121`, [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L18-L25) | 기준선 표기(`4b66d1d`, NFR v1.1, FRD/BR v1.2, `DEC-001~080`, `Q-081` 1건)를 `2f1db92`, NFR v1.3, FRD/BR v1.4, `DEC-081~121`, `Q-081·085·087·091·092`로 갱신 및 해소된 GAP 정리. | 아니오 |
| RB-019 | minor | [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L13) (§1 L13·31-41, §6.4 L220·222·244, §7 L259, §10 L283) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L92-L132) `DEC-081~121` | 기준선 표기(`4b66d1d`, `DEC-001~080`)와 `"커밋 전"`/`"4b66d1d에 없는"`/`Q-후보-19` 표기를 `2f1db92`·DEC 번호 기준으로 갱신. §6.4 L222의 `PV-017` 전제에 `Q-087 [미확인]` 병기. | 아니오 |
| RB-020 | minor | [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L13) (§1 L13·31-40, §5 L140, §8 L171, §9 L180-184) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L92-L132) `DEC-081~121` | 기준선 표기(`4b66d1d`, `DEC-001~080`), `"커밋 전"` 표기 및 §9 추적 표의 해소된 GAP 참조(`GAP-004·005·010·012·021·034`)를 `2f1db92`·DEC 기준으로 갱신. | 아니오 |
| RB-021 | minor | [0003-backend-stack.md](../../../docs/decisions/0003-backend-stack.md#L17) (L17) | [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L97) `DEC-086` | L17의 "1 GB의 단위 확정은 GAP-004에 남아 있다"를 `DEC-086` 확정(`1,073,741,824 B`)으로 갱신(스택 선택 자체는 새 기획과 모순 없음). | 아니오 |
| RB-022 | minor | (기획 문서) [NFR.md](../../../docs/01-planning/nfr/NFR.md#L3), [FRD.md](../../../docs/01-planning/frd/FRD.md#L3), [BR.md](../../../docs/01-planning/business-rules/BR.md#L3), [PRD.md](../../../docs/01-planning/prd/PRD.md#L3), [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md#L92) | `develop 2f1db92` 머지 기준선 | PR #99(`2f1db92`)로 머지된 기획 문서 상단이 여전히 `기획 기준선 v1.0 = develop 4b66d1d(승인⑤), ... 호배님 승인 대기`로 남아 있고 `DEC-081`도 `4b66d1d`로 적혀 있어 기준선 식별 혼선을 유발함. | 예 (기획 문서 헤더와 `DEC-081`/승인 기록을 `2f1db92` 기준으로 정리해야 함) |

---

## 3. 04 GAP 및 열린 질문 처리 권고

### 3.1 해소된 것으로 보이는 04 GAP
- **GAP-012 (세션 수명 부재)**: **해소됨** (`DEC-092`, `NFR-SEC-006` — 유휴 7일, 최대 30일 만료).
- **GAP-034 (정지 회원의 토큰 갱신·Litpage 진입)**: **해소됨** (`DEC-098`, `NFR-SEC-002` — 재로그인·토큰 갱신·Litpage 진입 모두 새 로그인으로 보아 차단, `DEC-027` 정정). 단, 갱신 차단까지 최대 시간은 `Q-087 [미확인]`으로 이관.
- **기타 해소된 GAP**:
  - `GAP-001`, `GAP-002`, `GAP-029` (`DEC-081` 우선순위·버전 규칙; 단 `RB-022` 헤더 정리는 필요)
  - `GAP-003` (`DEC-082` CO-01·02=Cloudflare 대시보드, CO-03=Google Cloud Console)
  - `GAP-004` (`DEC-086` 1,073,741,824 B·폴더 업로드, `DEC-106` 초과 제외, `DEC-107` 0바이트 차단, `DEC-108` 이름 충돌 번호)
  - `GAP-005` (`DEC-090` 분할·이어 올리기 없음. 단 `CO-02` 프록시 한도 확인은 `RB-017`로 남음)
  - `GAP-006` (`DEC-087` p95·최초 생성/Google 제외·Litpage 포함)
  - `GAP-007` (`DEC-088` 최근 60초 활성 세션 20개·오류율 0.1%·80/100명 경보만)
  - `GAP-008` (`DEC-089` 알린 점검·외부 장애 제외, 출시 후 한 달 관찰)
  - `GAP-009` 일부 (`DEC-091` 백업 범위=회원 정보·파일만. 단 RPO/RTO/복원 훈련은 미정이라 PV-013·014 유지)
  - `GAP-010` (`DEC-083` 백업 30일 자동 만료, 복원 시 삭제 재적용)
  - `GAP-011` 일부 (`DEC-104` 관리자 감사 기록 남김. 항목·기간·법적 적정성은 `Q-091 [미확인]`)
  - `GAP-013`, `GAP-033` (`DEC-093`, `DEC-099`, `DEC-111`, `DEC-114` 정지 유지·데이터 복구·받은 공유 미복구·보관 중 보기만)
  - `GAP-014` (`DEC-094` 지금 쓰는 기기만 로그아웃)
  - `GAP-015` (`DEC-095`, `DEC-109` 다운로드 금지 시 원본 미전송·화면용만, 형태는 설계 이관)
  - `GAP-017` (`DEC-084` 터치 기기 마우스 올림 썸네일 생략)
  - `GAP-019`, `GAP-035` (`DEC-100`, `DEC-110` 로그인 화면 언어 전환·계정 저장·계정 언어 우선·Litpage 언어 동기화)
  - `GAP-020` (`DEC-103`, 할 일 `T-01`·`T-02`로 분리)
  - `GAP-021` 일부 (`DEC-096` 달력 30일·탈퇴 보관 중 휴지통 시계 계속. 시간대·경계는 `Q-085 [미확인]`)
  - `GAP-024` (`DEC-085` 지표 집계는 로그와 별도 보관. 보관 기간 `[미확인]`)
  - `GAP-026` (`DEC-097`, `DEC-112` 충돌 사본 `'이름 (충돌 사본)'`, 버전 최근 10개 30일 보관)
  - `GAP-027` 일부 (`DEC-105` 전체 저장 용량 운영 경보, 업로드 미차단. 기준 수치는 `Q-092 [미확인]`)

### 3.2 여전히 열린 GAP 및 질문 처리 권고 (`[미확인]` 유지)
- **GAP-016 (기본 보안선)**: 새 [NFR.md](../../../docs/01-planning/nfr/NFR.md#L252) §5가 "보안 NFR은 새로운 기술 수단을 지정하지 않는다"고 유지하며 라운드 16~19에서 추가되지 않았다. 설계 기본선(`PV-022`, `PV-023`, `04` §4.9)을 **설계 자체 기본선(제안값)**으로 유지한다.
- **GAP-018 (NFR-COMP-002 "최신" 브라우저 정의)**: 새 `NFR.md`·`AC-NFR-COMP-002-01`에서도 정의되지 않았다. **열린 상태 유지** 및 `PV-025`(시험일 기준 stable 최신 메이저) 제안값 유지.
- **GAP-025 (Litpage 자동 저장 지연·재시도·실패 정의·1GB 한도 적용)**: 새 `FRD.md` §FR-OSS-003·`AC-FR-OSS-003-01·02`에서도 미정(저장 파일 형식은 설계 이관). **열린 상태 유지**, 추후 저장소/오픈소스 연동 설계에서 확정 필요.
- **Q-085 (달력 날짜 30일 시간대·경계 시각·시작일)**: **`[미확인]` 유지**. `04`·`05`의 `AS-009`(30×24시간 UTC)를 제거하고 `Q-085` 확인 전까지 경계 시각을 단정하지 않는다.
- **Q-087 (정지 회원 열린 세션 토큰 갱신 차단 최대 시간)**: **`[미확인]` 유지**. 설계 이관 성격이나 호배님 확인 필요(`open-questions.md`). `05` §6.4의 `PV-017`(≤5분) 전제는 제안값으로만 구분한다.
- **Q-091 (감사 기록 항목·보관 기간)**: **`[미확인]` 유지**. 정식 배포 전 `Q-081`과 함께 법적 적정성 확인 예정이므로 설계에서 임의 확정하지 않는다.
- **Q-092 (전체 저장 용량 경보 기준 수치·수신 대상·방법)**: **`[미확인]` 유지**. 경보 기능의 경계만 설계에 두고 임계값은 비워 둔다.

---

## 4. 04·05·06·ADR 0003 사이 불일치

1. **정지·세션 처리 (`04` ↔ `05`·`06`)**: `04`는 옛 `DEC-027` 기준으로 T+1시간 API 200 및 기존 세션 Litpage 사용 가능을 검증(`PV-018`, `PV-029`)하는 반면, `05`(§6.4)와 `06`(§5, §8)은 새 기준(`DEC-092`, `DEC-098`)에 따라 토큰 회전·Litpage 진입 차단을 명시하고 있다.
2. **NFR 항목 수 및 설계 문서 번호 매핑 (`04` ↔ `05`·`06`)**: `04`는 NFR 18개 체제(`SEC-006`, `USAB-002`, `USAB-003`, `OPS-003`, `OPS-004` 누락)이며 §8.2에서 `05=시스템 구성·배포`, `06=인증·IdP·세션`으로 추정했으나, 실제 `05`는 C4 아키텍처(인증을 09로 이관), `06`은 크레이트 구조로 작성되었다. `05` §9에는 `DEC-101`·`102`가 반영되었으나 `04`에는 없다.
3. **백업 범위 (`04` `AS-013` ↔ `05` §7)**: `04` `AS-013`은 공유·링크·설정까지 DB·파일 전체 백업을 가정하고, `05` §7은 `DEC-083`만 언급해 `DEC-091`(회원 정보·파일만)을 아직 반영하지 않았다.
4. **업로드 방식 (`04`·`05`·`06` ↔ `ADR 0003`)**: `04`·`05`·`06`은 모두 8 MiB 분할·재개(`PV-002`)를 전제하나, `ADR 0003` Mac 스파이크는 단일 HTTP 요청(`Content-Length` / `Transfer-Encoding: chunked`) 스트리밍을 확인했다(따라서 `ADR 0003` 스택 자체는 `DEC-090` 단일 업로드와 호환됨).

---

## 5. 검토하지 못한 부분과 이유

- [06F-stack-feasibility.md](../../../docs/02-architecture/06F-stack-feasibility.md) 및 `docs/02-architecture/_reviews/` 하위 파일: `ADR 0003` 본문에서 스택 모순 여부를 직접 확인했으므로 보조 문서는 전체 열람하지 않았다.
- [matrix.csv](../../../docs/01-planning/traceability/matrix.csv), [round-18.md](../../../docs/01-planning/01-interview/round-18.md), [round-19.md](../../../docs/01-planning/01-interview/round-19.md), [PRD.md](../../../docs/01-planning/prd/PRD.md) 전체 본문, [carry-over/README.md](../../../docs/01-planning/carry-over/README.md): `decision-log.md`(`DEC-081~121`), `open-questions.md`, `NFR.md`, `FRD.md`, `BR.md`, `AC.md`에서 원문을 확인했으나, `matrix.csv` 전체 행 단위 추적 누락과 `CO-02` Cloudflare 실제 플랜·프록시 경유 여부는 확인하지 못했다(`[미확인]`).
- `.env*`, 비밀 파일, `.docx`, 이미지 및 git 이력: 읽기 전용 작업 규칙과 `.git` 미포함 사본 환경으로 인해 읽지 않았다.