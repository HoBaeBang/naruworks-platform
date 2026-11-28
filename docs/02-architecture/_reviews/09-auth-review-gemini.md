<!-- naru-orch job=P2-10-auth-09-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=bf474f71-6218-4b35-97fb-974581df23d0 saved=2026-11-26T21:37:02+09:00 -->

## 1. 요약

- **심각도 집계**: [09-auth.md](../../../docs/02-architecture/09-auth.md) (blocking 0 / major 0 / minor 0), [07-api.md](../../../docs/02-architecture/07-api/07-api.md) (blocking 0 / major 0 / minor 0), [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml) (blocking 0 / major 0 / minor 0), [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md) · [0001_init.sql](../../../docs/02-architecture/08-db/migrations/0001_init.sql) (변경 없음, 불일치 0) — **총계: blocking 0 / major 0 / minor 0**
- **B-1·B-2 상태**: Litpage SSO는 B-2(공유 세션 또는 내부 토큰)를 **기본안**으로 두고 B-1(얇은 OIDC 제공자)과 비교하되, 최종 채택은 **『호배님 결정 대기』**로 명시되어 있습니다.
- **쿠키·CSRF·페이지 크기 및 07 반영**: `naru_session` 쿠키 속성(`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Domain`·`Expires` 생략, `Max-Age`는 절대 만료 잔여 초), `GET /auth/session`의 `X-CSRF-Token` 전달 및 변경·진입 경로의 `csrfHeader` 적용·회전, 목록 `limit`(기본 50, 최대 100)이 [07-api.md](../../../docs/02-architecture/07-api/07-api.md) v0.3과 [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml) v0.3에 누락 없이 반영되었습니다.
- **08 변경 없음 주장의 타당성**: 타당합니다. 쿠키 불투명 자격 원문의 SHA-256 다이제스트만 `sessions.credential_digest`에 저장하고 서버 전용 CSRF 키로 `HMAC-SHA-256`을 산출·검증하므로, 별도 CSRF DB 컬럼 없이 발급·회전·폐기가 가능하며 [0001_init.sql](../../../docs/02-architecture/08-db/migrations/0001_init.sql)의 기존 `members`·`sessions` 컬럼과 모두 정합합니다.

---

## 2. 설계 결함 표

**남은 blocking/major 없음** (minor 결함도 발견되지 않음).

---

## 3. 점검 목록

| 항목 | 판정 | 근거 |
| --- | --- | --- |
| 1. 23장·ADR 0004·호배님 결정 일치 | **충족** | [09-auth.md](../../../docs/02-architecture/09-auth.md#L11-L20)에서 axum 직접 Google 로그인(선택지 B), Keycloak 제거 및 데이터 무이관, Litpage 인증 계층 재작성, CO-03 위치(Google Cloud Console)만 기재·비밀 값 0건을 유지하고, [09-auth.md §4](../../../docs/02-architecture/09-auth.md#L130)에서 B-2 기본안과 『호배님 결정 대기』를 명시했습니다. |
| 2. 기획 DEC/NFR/FR 반영 | **충족** | DEC-092(유휴 7일/절대 30일), DEC-094(현재 기기 통합 로그아웃), DEC-098(재로그인·갱신·Litpage 진입 차단, 정지 시 열린 세션 즉시 종료 안 함), DEC-114(보관 중 재가입 복구 및 정지 유지), DEC-118·119(`returnTo` 동일 오리진 허용 목록 상대 경로 제한 및 기로그인 홈 이동), NFR-SEC-001·002·005·006, FR-AUTH-001~006이 모두 반영되었습니다. |
| 3. 07 v0.3·08 v0.1 정합 | **충족** | [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml)의 모든 변경(POST/PUT/PATCH/DELETE) 작업에 `sessionCookie` + `csrfHeader`가 적용되었고, `getSession`·`refreshSession`의 `X-CSRF-Token`, `Limit`(1~100, 기본 50), 오류 코드(`INVALID_LOGIN_CALLBACK`, `MEMBER_SUSPENDED`, `CSRF_REJECTED`, `LINK_UNAVAILABLE`, `ADMIN_REQUIRED`)가 09와 일치하며 08은 변경 없이 전제 컬럼을 충족합니다. |
| 4. 흐름 완전성 | **충족** | Google 시작/콜백(PKCE `S256` + RFC 9700 §2.1.1 근거, 일회용 `state`·`nonce`·임시 쿠키 바인딩), 세션 발급/갱신, 정지 차단, 현재 기기 통합 로그아웃, 게스트 공개 링크, 관리자 접근의 본문과 6개 Mermaid `sequenceDiagram` 간 모순이 없습니다. |
| 5. PV-017/018 시험 방법 | **충족** | [09-auth.md §9](../../../docs/02-architecture/09-auth.md#L272-L280)에서 로그아웃 전파 p99 ≤ 5초·API p95 ≤ 2초(PV-017·028)와 정지 후 새 로그인 차단 ≤ 5초(PV-018)를 [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md)의 설계 제안값으로 유지했고, Q-087을 [미확인]으로 남겼습니다. |
| 6. 위협·완화 표 | **충족** | [09-auth.md §10](../../../docs/02-architecture/09-auth.md#L282-L291)에서 세션 탈취·고정, CSRF, 오픈 리다이렉트, 정지 우회, OAuth 코드 주입·재사용, 공개 링크 유출·권한 재사용이 본문의 실제 완화 수단 및 잔여 [미확인] 항목과 일관되게 연결됩니다. |
| 7. 금지·미확인 단정 여부 | **충족** | RB-017, GAP-016·018·025, Q-081·085·087·091·092, DM-002·004·006·007·009·010·011, SSO 최종 채택, CO-03 재사용/재발급/redirect URI, 배포 호스트·`Domain` 미확정 등이 모두 단정 없이 [미확인]으로 유지되었고 비밀 값·계정명 기재가 없습니다. |

---

## 4. SSO 비교와 『호배님 결정 대기』 표기 확인

- [09-auth.md §4](../../../docs/02-architecture/09-auth.md#L128-L147)에서 `B-1 나루가 얇은 OIDC 제공자`와 `B-2 공유 세션 또는 내부 토큰`을 이점·제약, 보안과 로그아웃, Litpage 수정량(`oidc.ts`·`auth.ts`·`db.ts` 참고), 운영 부담 관점에서 비교하고 있습니다.
- 본문 시작부([09-auth.md#L130](../../../docs/02-architecture/09-auth.md#L130)), 전파 제안([09-auth.md#L174](../../../docs/02-architecture/09-auth.md#L174)), 남은 미확인([09-auth.md#L307](../../../docs/02-architecture/09-auth.md#L307)), 그리고 [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L28) 및 [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml#L189) 모두 **기본안 B-2 · 『호배님 결정 대기』**로 일관되게 표기되어 있으며, 08 DB에 SSO 전용 테이블을 확정 추가하지 않았습니다.

---

## 5. 남은 [미확인] 목록 (09 §11과 원문 대조)

| 항목 | 원문 대조 결과 ([open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md), [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md), [07-api.md](../../../docs/02-architecture/07-api/07-api.md)) |
| --- | --- |
| RB-017 [미확인] | 04 §4.1·07 미확인 표와 일치(CO-02 프록시 경로·본문 한도와 1 GiB 단일 요청 양립 여부). |
| GAP-016 [미확인] | 04 §4.9·07 미확인 표와 일치(기획 기본 보안선 미정, PV-022·023은 04 제안값 유지). |
| GAP-018 [미확인] | 04 §4.8·07 미확인 표와 일치(지원 브라우저 ‘최신’ 정의 및 iOS 타 브라우저 취급). |
| GAP-025 [미확인] | 04 §4.1·07 미확인 표와 일치(Litpage 자동 저장 지연·재시도·실패 정의·1 GiB 적용·무손실 패키징). |
| Q-081·085·087·091·092 [미확인] | `open-questions.md` 열린 질문 5건과 모두 일치(단정·임의 해소 없음). |
| DM-002/004/006/007/009/010/011 [미확인] | 07 디자인 목록과의 차이 표 및 미확인 표와 일치. |
| SSO [미확인] | ADR 0004 후속·07 미확인 표와 일치(최종 채택은 『호배님 결정 대기』, B-2 내부 경로·자격·웹소켓 전파·MCP 인증·실측 미확인). |
| CO-03 [미확인] | `carry-over/README.md`와 일치(Google Cloud Console 위치만 기재, 재사용·재발급·redirect URI 등록 여부·권한자·교체 절차 미확인). |
| 배포·인증 구현·검증 [미확인] | 배포 호스트명(`Domain` 생략은 09에서 확정), Rust 인증 크레이트, 로그인 시도 저장소, 관리자 식별자 위치, 활동 집계 경로, 복귀 allowlist, CSRF 키 교체, 정지 상태 탈퇴 가능 여부, 커서 유효기간, 시험 실측 등 미확인 유지. |

---

## 6. 09와 07 v0.3, 또는 09와 08 사이 불일치

- 확인된 불일치 **없음**.

---

## 7. 검토하지 못한 부분과 이유

- **실제 런타임·백엔드 코드 및 스테이징 검증** [미확인]: 읽기 전용 문서 검토이며 구현 코드·스테이징 환경·Google Cloud Console·Litpage 실행 환경이 제공되지 않아 실제 OIDC 교환, 쿠키/CSRF 동작, PV-017/018/029 실측 지연은 확인하지 못했습니다.
- **OpenAPI 린터 및 Mermaid 렌더러 실행** [미확인]: 지시문에 따라 도구 미사용 범위로 두었으며, YAML 구문 파싱(`yaml.safe_load`)과 텍스트/구조 대조로만 확인했습니다.