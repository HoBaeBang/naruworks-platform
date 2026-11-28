<!-- naru-orch job=P2-12-auth-sso-b1-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=e53f1ab2-ab61-4534-a332-44150c985b70 saved=2026-11-26T22:03:37+09:00 -->

# SSO B-1 반영 문서 검토 결과

## 1. 요약

| 대상 문서 | blocking | major | minor | 비고 |
|---|---:|---:|---:|---|
| [09-auth.md](../../../docs/02-architecture/09-auth.md) (v0.2) | 0 | 0 | 0 | B-1 계약·로그아웃·정지·위협표·미확인 반영 |
| [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md) (개정 2) | 0 | 0 | 0 | 21:45 KST B-1 결정 및 B-2 기각 반영 |
| [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml) (v0.4) | 0 | 0 | 0 | OP·RP 경로, 스키마, 기존 Auth/CSRF 유지 |
| [07-api.md](../../../docs/02-architecture/07-api/07-api.md) (v0.4) | 0 | 0 | 0 | B-1 OIDC 계약 표·변경 이력 반영 |
| [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md) (v0.2) | 0 | 0 | 0 | OIDC 5개 테이블·참조 기반 비밀 관리 반영 |
| [0001_init.sql](../../../docs/02-architecture/08-db/migrations/0001_init.sql) (v0.2) | 0 | 0 | 0 | 08 본문과 테이블·컬럼·제약 일치 |
| [05-architecture.md](../../../docs/02-architecture/05-architecture.md) (v0.4) | 0 | 0 | 0 | v0.4 유지, SSO 문구 B-1 최소 수정 |
| [06-crate-layout.md](../../../docs/02-architecture/06-crate-layout.md) (v0.4) | 0 | 0 | 0 | v0.4 유지, SSO 문구 B-1 최소 수정 |
| **총계** | **0** | **0** | **0** | |

- **B-1 결정 및 B-2 기각**: 호배님 2026-11-26 21:45 KST 결정대로 SSO B-1(나루 얇은 OIDC OP + Litpage 기밀 RP)이 채택되었고 B-2(공유 세션/내부 토큰)는 기각 대안으로 이유와 함께 명시되었다.
- **로그아웃·정지 차단**: 현재 기기 통합 로그아웃은 나루 시작 시 백채널(`logout_token`), Litpage 시작 시 RP-Initiated Logout(`end_session`) + 백채널 전파를 제안하며 다른 기기 `sid`는 유지한다(DEC-094). 정지는 Google 재로그인·OP authorize/token/UserInfo·`enterLitpage`/`openLitpageDocument`·세션 갱신에서 차단하고, 정지 커밋 자체만으로 열린 세션을 즉시 종료하지 않는다(DEC-098).
- **07 v0.4 / 08 v0.2 반영**: 07 v0.4에 OP 경로 6종과 Litpage 백채널 수신 경로가 추가되었고 기존 Auth·쿠키(`naru_session`)·CSRF·`limit`(기본 50/최대 100)이 유지되었다. 08 v0.2에 `oidc_clients`, `oidc_authorization_codes`, `oidc_signing_keys`, `oidc_token_grants`, `oidc_logout_deliveries`가 추가되었으며 키/시크릿 평문은 없다.

## 2. 설계 결함 표

남은 blocking/major 없음. (minor 결함도 없음.)

## 3. 점검 목록

| 항목 | 판정 | 한 줄 근거 |
|---|---|---|
| 1. 호배님 결정·ADR 0004 일치 | 충족 | [09-auth.md](../../../docs/02-architecture/09-auth.md#L137)와 [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L14)에 21:45 KST B-1 확정·B-2 기각, 로그인 B, Litpage 인증 재작성, Keycloak 제거·미이전, CO-03 위치 참조만 반영되고 비밀 값 0건이다. |
| 2. 기획 DEC/NFR/FR 반영 | 충족 | DEC-092·094·098·114·118·119, NFR-SEC-001/002/005/006, FR-AUTH-001~006이 반영되었고, `returnTo` 동일 오리진 상대 경로 제한과 정지 시 열린 세션 즉시 미종료·타 기기 유지가 일치한다. |
| 3. 09·07 v0.4·08 v0.2 정합 | 충족 | OP/RP 경로·수명(`expires_in` 최대 300초)·`sid` 상관 식별자·5개 OIDC 테이블·컬럼·제약이 본문·OpenAPI·SQL에서 일치하며 05/06에 B-2 잔여 문장이 없다. |
| 4. B-1 흐름 완전성 | 충족 | PKCE `S256`, Discovery, JWKS, `RS256`, 정적 등록, 키 회전, 세션 상한, 정지 차단 경계, 양방향 로그아웃, Litpage 재작성 범위([oidc.ts](../../../services/litpage/apps/server/src/oidc.ts), [auth.ts](../../../services/litpage/apps/server/src/auth.ts), [db.ts](../../../services/litpage/apps/server/src/db.ts)) 및 7개 Mermaid 다이어그램이 본문과 모순 없이 완결되었다. |
| 5. PV-017/018 시험 방법 | 충족 | [09-auth.md §9](../../../docs/02-architecture/09-auth.md#L346-L350)에서 [04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md)의 제안 목표임을 유지하고 Q-087을 [미확인]으로 남겼다. |
| 6. 위협·완화 표 | 충족 | [09-auth.md §10](../../../docs/02-architecture/09-auth.md#L354-L364)에 기존 6개 위협과 B-1 추가 3개 위협(미등록 redirect URI, 토큰 위조·변조, 서명 키 유출)이 본문 완화와 연결되어 있다. |
| 7. 금지·미확인 미단정 | 충족 | RB-017, GAP-016·018·025, Q-081·085·087·091·092, DM-002·004·006·007·009·010·011, CO-03 세부, 배포 호스트·크레이트 선정이 모두 [미확인]/[스파이크 필요]로 유지되었다. |

## 4. B-1 결정 문구, B-2 기각 표기, 위협 표 추가 행 확인

- **B-1 결정 문구**:
  - [09-auth.md §4](../../../docs/02-architecture/09-auth.md#L137): `**『결정: B-1(2026-11-26 21:45 KST 호배님)』.** 나루 axum이 얇은 OIDC 제공자(OP), Litpage가 기밀 RP로 동작한다.`
  - [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L24): `**Litpage SSO는 B-1로 결정했다(2026-11-26 21:45 KST 호배님).**` (개정 이력 2번 및 7번 줄에도 2026-11-26 21:45 KST 명시)
- **B-2 기각 표기**:
  - [09-auth.md §4.3](../../../docs/02-architecture/09-auth.md#L231): `B-2 공유 세션 또는 내부 토큰 | **기각.** 호배님이 2026-11-26 21:45 KST에 B-1을 선택했다.` (동일 오리진·콘텐츠 격리 부담, 별도 신뢰 경계·어댑터 필요 사유 기재)
  - [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L77): `B-2 공유 세션 또는 내부 SSO 토큰 | **기각.** 호배님이 2026-11-26 21:45 KST에 B-1을 선택했다.`
- **위협 표 추가 행** ([09-auth.md §10](../../../docs/02-architecture/09-auth.md#L360-L362)):
  - `등록되지 않은 redirect URI`: authorize·token 정적 등록 URI 정확 대조, 로그아웃 복귀 URI 별도 등록·대조, 검증 전 외부 리다이렉트 금지.
  - `ID·액세스 토큰 위조·변조`: ID 토큰 `RS256`·JWKS·`iss`·`aud`·`nonce`·만료 검증, UserInfo 불투명 토큰 다이제스트·용도·세션·회원 상태 대조, `logout_token` 별도 클레임 검증.
  - `서명 키 유출`: 개인 키는 OP 배포 비밀 저장소에 격리, 정상 회전 시 검증 여유 부여, 손상 의심 시 즉시 배제 및 RP 캐시 무효화 연계.

## 5. 남은 [미확인]·[스파이크 필요] 목록 (09·ADR 0004 vs 원문 대조)

기획 원문([open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md), [carry-over/README.md](../../../docs/01-planning/carry-over/README.md)) 및 설계 원문([04-NFR-technical.md](../../../docs/02-architecture/04-NFR-technical.md))과 대조한 결과 모두 단정 없이 보존되었다.

- **기획·설계 이관 [미확인]**: `RB-017`(Cloudflare 프록시 vs 1 GiB 업로드), `GAP-016`(기본 보안선), `GAP-018`(지원 브라우저 최신 기준·iOS 타 브라우저), `GAP-025`(Litpage 자동 저장 지연·재시도·실패 정의·1 GiB 적용), `Q-081`(사업자·운영자 표시 법적 요건), `Q-085`(달력 30일 시간대·경계·시작일), `Q-087`(열린 세션 토큰 갱신 차단 최대 시간·갱신 주기), `Q-091`(감사 기록 항목·보관 기간), `Q-092`(저장 용량 경보 기준·수신 대상·방법).
- **디자인·API·DB [미확인]**: `DM-002/004/006/007/009/010/011` ([09-auth.md §11](../../../docs/02-architecture/09-auth.md#L379)에 명시).
- **CO-03·배포 [미확인]**: 기존 Google OAuth 클라이언트 재사용·재발급·접근 권한자·교체 절차·redirect URI 재사용/추가 등록 여부, 실제 배포 호스트명·서비스별 오리진 배치(쿠키 `Domain` 생략은 확정).
- **B-1 구현·운영 [미확인]**: RP 등록 URI·배포 비밀 저장소 구체 위치, 진입 컨텍스트 전달 계약, 갱신·키 회전 주기·JWKS 캐시·백채널 통지 재시도/폐기 기록 보존 경계, 웹소켓·MCP 인증 대체 계약, 로그인 시도 저장소·활동 집계 경로·화면 allowlist·CSRF 키 교체·정지 상태 탈퇴 가능 여부·페이지 정렬/커서 유효기간·종단 실측.
- **[스파이크 필요]**:
  - 인증 라이브러리 선정 및 동작·취약점·호환성 검증([09-auth.md §11](../../../docs/02-architecture/09-auth.md#L381), [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L79)).
  - 무손실 패키징 왕복 재열기 검증([09-auth.md §11](../../../docs/02-architecture/09-auth.md#L382), [0004-auth-idp-litpage.md](../../../docs/decisions/0004-auth-idp-litpage.md#L101)).

## 6. 문서 간 불일치

09(v0.2), 07(v0.4, `openapi.yaml`), 08(v0.2, `0001_init.sql`), ADR 0004(개정 2), 05/06(v0.4) 사이에서 **발견된 불일치 없음**.

## 7. 검토하지 못한 부분과 이유

- `docs/02-architecture/10-observability-ci.md` 및 `_reviews/10-observability-ci-review-gemini.md`: 작업 지시에 따라 이번 검토 대상에서 제외함.
- OpenAPI 린터 검증, Mermaid 문법 렌더링, `0001_init.sql`의 실제 PostgreSQL 실행 검증: 읽기 전용 검토 환경 및 도구 미사용 조건에 따라 수행하지 않음.
- [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml)의 드라이브·공유·관리자 등 B-1 및 인증·세션 계약 외 상세 경로 정의 전체: 범위 외 항목으로 Auth·OIDC·Litpage·공통 스키마 중심으로 확인함.