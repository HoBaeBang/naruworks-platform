<!-- naru-orch job=P2-7-adr-0004-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=e6bc550c-3b67-4732-b773-7c3f18c8dac9 saved=2026-11-26T20:40:24+09:00 -->

### 1. 요약

| 대상 문서 | blocking | major | minor | 합계 |
|---|---:|---:|---:|---:|
| [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md) | 0 | 0 | 0 | 0 |
| [05-architecture.md](../../../docs/02-architecture/05-architecture.md) | 0 | 0 | 0 | 0 |
| [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md) | 0 | 0 | 0 | 0 |
| [06F-stack-feasibility.md](../../../docs/02-architecture/06F-stack-feasibility.md) | 0 | 0 | 0 | 0 |
| **총계** | **0** | **0** | **0** | **0** |

- **ADR 0004 추천 재진술**: SSO는 **B-2(공유 세션 또는 내부 SSO 토큰)**를 추천하며 최종 확정은 문서 09에 두고, 무손실 패키징은 **ZIP 사이드카(또는 ZIP 번들 내 부가 파일)**를 추천하며 최종 채택은 왕복 검증 스파이크 합격에 둡니다.

---

### 2. 발견 표

남은 blocking/major 없음 (minor 포함 발견된 결함 없음).

---

### 3. 점검 목록

1. **대안**: **충족** — [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L45-L69)에서 IdP(Keycloak 유지·외부 관리형 IdP·나루 자체 인증 + DB 이관 대안), Litpage 인증(기존 OIDC 유지·업스트림 재적용·인증 연결 계층 새로 작성), 드라이브 저장 형식(Markdown·CSV·네이티브 스냅샷/SQLite·HTML/PDF) 모두 3개 이상 대안과 채택/기각 이유를 명시함.
2. **SSO**: **충족** — [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L28) 및 [§SSO 방식](../../../docs/decisions/0004-auth-idp-litpage.md#L71-L78)에서 B-1과 B-2를 비교한 뒤 B-2를 **추천**으로 명시하고 최종 결정을 문서 09로 유보함.
3. **무손실 패키징**: **충족** — [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L80-L85) 및 [§무손실 왕복 검증 스파이크](../../../docs/decisions/0004-auth-idp-litpage.md#L100-L118)에서 확장 문법·front matter와 ZIP 사이드카를 비교해 ZIP 사이드카를 추천하고, 무손실 여부 `[미확인]`, 5종 문서 유형별 비교 속성·합격/실패 기준, 실패 시 보류 후 호배님께 보고해 재결정(형식 2 임의 전환 금지)을 명시함.
4. **정지·세션**: **충족** — [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L87-L96)에서 DEC-098(재로그인·토큰 갱신·Litpage 진입 차단, 열린 세션 즉시 종료 안 함, DEC-027 정정 명시), DEC-092/NFR-SEC-006(유휴 7일·절대 30일), PV-017·028·018·029 검증 방식을 설명하고 Q-087을 `[미확인]`으로 유지함.
5. **05·06·06F 연결**: **충족** — [05-architecture.md](../../../docs/02-architecture/05-architecture.md#L268-L270), [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md#L94-L97), [06F-stack-feasibility.md](../../../docs/02-architecture/06F-stack-feasibility.md#L290-L295) 모두 인증/IdP만 ADR 0004(및 GAP-028 해소)로 전환하고 파일 저장소·잡 러너·프런트엔드는 `[ADR 대기]`/미정을 유지하며 정책 모순이 없음.
6. **ID·비밀 값·API·ADR 0003 충돌 여부**: **충족** — 인용된 FRD·NFR·BR·AC·DEC·PV·GAP·Q ID와 `services/litpage/` 파일 경로가 실제 문서·저장소와 일치하며, 비밀 값 없이 CO-01~03 보관 위치만 기재했고 ADR 0003 스택(`axum` 0.8.x, `sqlx` 0.8.x + `sqlx migrate`, `utoipa` 5.x, `tracing`·`tower-http`, `tokio` 1.x)과 충돌하지 않음.
7. **기획 원문 대조**: **충족** — 관리자 승인 없는 즉시 가입(FR-AUTH-001), 현재 기기만 통합 로그아웃(DEC-094), 유휴 7일·절대 30일(DEC-092), 정지 처리(DEC-098) 등이 [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md) 및 [FRD.md](../../../docs/01-planning/frd/FRD.md) 원문과 일치함.

---

### 4. 남은 [미확인] 목록

- **SSO 및 인증 구현 세부** ([0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L76-L78), [#L92-L95](../../../docs/decisions/0004-auth-idp-litpage.md#L92-L95), [#L122](../../../docs/decisions/0004-auth-idp-litpage.md#L122), [06F §11.1 U-14](../../../docs/02-architecture/06F-stack-feasibility.md#L320)): B-2 내 세션 공유 vs 내부 토큰 선택, 엔드포인트 계약·캐시·장애 시 동작, Litpage 자체 세션의 유휴 7일·절대 30일 적용 및 활동 시각 집계 방식, 토큰 수명만으로 5초 전파(PV-017) 충족 여부 및 30회 실측 결과, Litpage 종단 동작, Rust 인증 크레이트 선정·취약점 이력(U-14).
- **무손실 패키징·드라이브 연동** ([0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L29), [#L85](../../../docs/decisions/0004-auth-idp-litpage.md#L85), [#L102](../../../docs/decisions/0004-auth-idp-litpage.md#L102), [#L116](../../../docs/decisions/0004-auth-idp-litpage.md#L116)): 실제 무손실 왕복 복원 여부(왕복 스파이크 대기), ZIP 사이드카 메타데이터 스키마·파일 연결 방식, 버전 이력·댓글 반응 등 전체 보존 범위, 나루 드라이브 자동 저장 경로.
- **기획·기술 열린 질문 및 GAP/RB** ([0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L124-L125), [05 §11](../../../docs/02-architecture/05-architecture.md#L296-L304), [06 §10](../../../docs/02-architecture/06-crate-layout.md#L195-L202)): `Q-081`, `Q-085`, `Q-087`, `Q-091`, `Q-092`, `RB-017`, `GAP-016`, `GAP-018`, `GAP-025`, 외부 관리형 IdP 공급자별 동작·비용.
- **인프라·후속 ADR 대기** ([05 §11](../../../docs/02-architecture/05-architecture.md#L299-L300), [06 §8·§10](../../../docs/02-architecture/06-crate-layout.md#L178-L201)): 파일 저장소·잡 러너·프런트엔드 스택, 배포 토폴로지·IaC, 환경별 설정 파일 위치, 실제 PostgreSQL `#[sqlx::test]` 실행 및 부하·프록시 실측.

---

### 5. 05·06·06F·ADR 0004 사이 불일치

불일치 없음.

---

### 6. 검토하지 못한 부분과 이유

- `.env*` 및 비밀 파일, `.docx`, 이미지 파일: 작업 규칙상 열람 금지 대상이므로 읽지 않았습니다.
- `services/litpage/`의 `export.ts`, `import.ts`, `render.ts`, `csv.ts`, `spec.ts`, `records.ts`, `richtext.ts` 내부 상세 코드: 파일 존재 여부는 확인했으나 본문 전체를 읽지 않았으므로, 기존 내보내기/가져오기 구현의 세부 동작은 [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L102)와 [09-auth-options-gemini.md](../../../docs/02-architecture/_reviews/09-auth-options-gemini.md#L17) 요약에 의존해 확인했습니다.
- `BR.md`, `PRD.md`, `UF.md`, `NFR.md` 전체 본문: 이번 검토에서는 [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md), [decision-log.md](../../../docs/01-planning/02-decision-log/decision-log.md), [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md) 및 `FRD.md`·`AC.md` 해당 ID 검색으로 대조했고 나머지 원문 전체는 읽지 않았습니다.