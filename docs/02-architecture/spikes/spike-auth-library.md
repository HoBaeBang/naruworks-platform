# SPIKE-AUTH 인증 라이브러리 선정 계획

| 항목 | 값 |
| --- | --- |
| 버전 | v0.1 |
| 일시 | 2026-11-26 (KST) |
| 상태 | 초안, Gemini 검토 대기 |
| 기획 기준선 | develop `2f1db92` |
| 작업 브랜치 | `feature/NARU-94-architecture` |
| 설계 입력 | [07 OpenAPI](../07-api/openapi.yaml), [09 인증 §1~5·§9~11](../09-auth.md), [11 시험 계획 §5.1·§5.3](../11-test-plan.md) |
| 관련 결정 | [ADR 0003](../../decisions/0003-backend-stack.md), [ADR 0004](../../decisions/0004-auth-idp-litpage.md) |

## 1. 목표와 배경

axum 0.8.x·tokio 1.x에서 Google OIDC RP와 Litpage용 얇은 OIDC OP에 쓸 라이브러리 조합을 선정한다. 호배님은 2026-11-26 21:45 KST에 B-1(나루 OP·Litpage 새 RP)을 채택하고 B-2를 기각했다. **[기획]** DEC-098의 재로그인·토큰 갱신·Litpage 진입 차단과 DEC-094의 현재 기기 통합 로그아웃을 조합의 필수 조건으로 삼는다. CO-03 보관 위치는 Google Cloud Console이며 재사용·재발급 및 콜백 재사용·추가 등록은 **[미확인]**이다. [09 §1·§3~5](../09-auth.md), [ADR 0004](../../decisions/0004-auth-idp-litpage.md), [기획 결정 로그](../../01-planning/02-decision-log/decision-log.md)

## 2. 후보 비교 [제안]

버전은 공식 문서가 확인 시각에 표시한 최신 안정판이다. 라이선스는 공개 프로젝트 표기 기준이다. 릴리스 이력은 유지 상태의 판단 자료이며, 취약점·간접 의존성·빌드 호환성은 선정 전에 확인한다.

| 후보 | 확인 시각 (KST) | 최신 버전 | 라이선스·유지 상태 및 출처 |
| --- | --- | --- | --- |
| `openidconnect` | 2026-11-26 22:28~22:29 | 4.1.0 | MIT. 2026-10-31 릴리스, `oauth2 ^5.0.0`에 의존. [docs.rs 배포판](https://docs.rs/crate/openidconnect/latest), [API](https://docs.rs/openidconnect/latest/openidconnect/), [공식 저장소](https://github.com/ramosbugs/openidconnect-rs) |
| `oauth2` | 2026-11-26 22:29 | 5.0.0 | MIT OR Apache-2.0. 최신 안정판 배포일 2025-01-21. [docs.rs 배포판](https://docs.rs/crate/oauth2/latest), [API](https://docs.rs/oauth2/latest/oauth2/), [패키지 메타데이터](https://docs.rs/crate/oauth2/5.0.0/source/Cargo.toml) |
| `jsonwebtoken` | 2026-11-26 22:28~22:29 | 12.0.0 | MIT. 2026-11-13에 12판 배포, 암호 제공자 설정·RustCrypto 의존성 변경 확인. [docs.rs 배포판](https://docs.rs/crate/jsonwebtoken/latest), [API](https://docs.rs/jsonwebtoken/latest/jsonwebtoken/), [변경 이력](https://docs.rs/crate/jsonwebtoken/latest/source/CHANGELOG.md), [공식 저장소](https://github.com/Keats/jsonwebtoken) |
| `oauth-as` | 2026-11-26 22:29 | 1.1.0 | MIT OR Apache-2.0. 2026-11-14 릴리스. 배포 이력이 짧아 보안 수정·업그레이드 비용을 재검토한다. [docs.rs 배포판·README](https://docs.rs/crate/oauth-as/latest) |

‘가능’은 공개 API가 해당 기능을 제공하는 경우, ‘부분’은 경계·프로토콜 일부만 제공하는 경우, ‘불가’는 해당 기능을 제공하지 않아 별도 연결이 필요한 경우다. 아래는 문서 기반 판정이며 실행 결과는 **[미확인]**이다.

| 09 §4~5 계약 / 기능 | openidconnect | oauth2 | jsonwebtoken | oauth-as |
| --- | --- | --- | --- | --- |
| Google OIDC RP | 가능. 비동기 Discovery·코드 교환·ID 토큰 검증. Google 계정 정책은 앱 담당 | 부분. OAuth 코드 교환, OIDC 검증 별도 | 불가. JWT 검증 부품만 가능 | 불가. AS 측 |
| OP authorize·token, PKCE S256 | 불가. RP 쪽 challenge·교환 API는 가능 | 불가. 클라이언트 S256만 가능 | 불가 | 부분. AS 코드·S256·정확 URI·회전 지원. 나루 세션·최신 상태의 원자적 연결은 [미확인] |
| OIDC Discovery·JWKS | 부분. RP 조회·검증 | 불가 | 부분. JWK/JWK Set 부품, 게시 경로는 앱 담당 | 부분. RFC 8414 메타데이터·선택형 JWKS. 09의 OIDC Discovery 문서와 동일하지 않음 |
| RS256 ID 토큰과 UserInfo | 부분. RP 검증·호출 가능 | 불가 | 부분. RS256 서명·검증 부품. ID 토큰 정책·UserInfo는 앱 담당 | 부분. RS256/JWKS 부품은 있으나 문서의 JWT 액세스 토큰 계약과 09의 불투명 토큰·ID 토큰 계약은 별도 대조 필요 |
| RP 시작·백채널 로그아웃 | 독립 세션 전파·폐기 지원은 [확인 필요] | 불가 | 부분. 서명·검증만 지원. Logout Token 전송·재시도·세션 폐기는 앱 담당 | 해당 OIDC 계약 지원은 [확인 필요]. 배포판 문서에서 로그아웃 기능을 찾지 못함 |
| axum 0.8·tokio 1·oauth2 연계 | 비동기 HTTP 클라이언트와 oauth2 5 계열 사용 | 비동기 HTTP 옵션, tokio 1 개발 의존성 | 런타임 독립 JWT API. 암호 제공자·MSRV 검증 필요 | axum 0.8·tokio 1 선택 의존성, 문서의 상호 운용 시험에 oauth2 5.0.0 사용 |

**[제안] 1순위**는 Google RP에 `openidconnect`, 나루 OP 서명·검증 부품에 `jsonwebtoken`을 쓰고 OP 정책을 axum·sqlx 경계에서 구현하는 조합이다. RP의 표준 검증을 재사용하면서 OP의 불투명 토큰·회원 상태·세션 수명·로그아웃을 나루 트랜잭션에 직접 연결할 수 있다. OP 구현 범위는 09에 명시된 정적 RP 등록, Discovery·JWKS 게시, 인가·코드 소비·토큰 회전·UserInfo, 키 게시/회전 및 백채널 전달·폐기 기록이다. Litpage의 검증·세션·웹소켓 종료는 Litpage 서버 작업이다. [09 §4~5·§10](../09-auth.md), [08 OIDC 테이블](../08-db/08-db-schema.md), [openidconnect API](https://docs.rs/openidconnect/latest/openidconnect/), [jsonwebtoken API](https://docs.rs/jsonwebtoken/latest/jsonwebtoken/)

**[제안] 대안**은 Google RP에 `openidconnect`를 유지하고 OP 인가·토큰 코어에 `oauth-as`를 쓰는 조합이다. 정지·폐기와 코드 교환이 같은 원자성을 갖고, 09가 요구하는 등록·세션·토큰 정책을 유지할 때만 검토한다. OIDC Discovery·ID 토큰·UserInfo·백채널은 별도 작업 범위로 평가한다. `oauth2`는 RP 교환 부품 대안이며 ID 토큰의 서명·클레임 검증이 별도 필요하므로 전체 Google RP 대체로는 우선순위가 낮다. 지원이 **[확인 필요]**인 셀은 배포판 API·소스와 공식 changelog에서 확인하고, 근거가 없으면 직접 구현 범위로 기록한다. [oauth-as 배포판](https://docs.rs/crate/oauth-as/latest), [oauth2 API](https://docs.rs/oauth2/latest/oauth2/)

## 3. 성공 기준과 측정 방법

| 단계 | 합격 조건과 증적 |
| --- | --- |
| 이번 문서 | 후보 존재·최신 버전·확인 시각·공식 URL, 09 계약별 지원 표, 추천·대안의 근거와 직접 구현 범위를 기록한다. 미검증 기능과 운영 전제는 열린 상태로 둔다. |
| 승인 후 문서/API 검토 | 07 §Litpage B-1과 09 §4~5의 계약 전 항목에 지원 판정·API 근거·담당 구성요소를 연결한다. 부분·불가 항목은 구현 범위와 대응 TP가 있어야 한다. 후보별 라이선스·지원 Rust 버전·전이 의존성·권고 검토와 axum 0.8·tokio 1 타깃 빌드 결과를 남긴다. |
| 승인 후 프로토콜 검증 | Google 신규·기존 로그인과 취소, Discovery·JWKS, authorize·token·UserInfo에서 정상이 성공하고 URI·PKCE·서명·클레임 오류는 거부된다. 일회 코드 소비·갱신 회전은 경합에도 중복 발급 0건. 주체·세션 연결, 현재 정지 상태 판정, CSRF 및 회전도 확인한다. `TP-C-OIDC-LOGIN`, `TP-I-OIDC-GRANTS`, `TP-C-SESSION-CSRF`, `TP-C-OIDC-KEYS`, `TP-C-SEC-002-01`. |
| 승인 후 로그아웃 검증 | 두 기기에서 나루 시작·RP 시작 경로를 각각 확인한다. 현재 기기 세션·웹소켓만 종료되고 다른 기기는 유지되며, 잘못된 Logout Token은 거부되고 재시도·중복 수신에도 상태가 일관된다. 스테이징 종단은 11의 `TP-E-SEC-001-01`과 PV-017·028(경로별 30회, 전파 최댓값 ≤5초·API p95 ≤2초 제안)에 증적을 연결한다. |
| 승인 후 보안 검토 | 고정 issuer 및 등록 redirect URI 정확 일치, 서버 측 일회성 state·nonce·verifier, 백엔드 HTTP 자동 redirect 비활성화, 유효 알고리즘 고정 및 로그 자격 마스킹을 문서·설정·시험으로 교차 확인한다. 백채널은 등록 URI와 서명·필수 클레임·sid 검증을 대조한다. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), [OIDC Back-Channel Logout](https://openid.net/specs/openid-connect-backchannel-1_0-final.html), [openidconnect 보안 안내](https://docs.rs/openidconnect/latest/openidconnect/) |

실행 승인 뒤 샌드박스에서 합성 회원·테스트 등록·격리 DB로 최소 동작을 확인한다. 실제 Google의 Google Cloud Console 등록을 쓰는 검증에는 테스트 등록 권한이 필요하다. 자격 값 없이 경계별 요청 ID·시각·판정·의존성 버전을 남긴다. 정지된 기존 세션의 최대 차단 시간 Q-087과 기본 보안선 GAP-016은 **[미확인]**이다. [09 §9·§11](../09-auth.md), [11 §2·§5.1·§5.3](../11-test-plan.md)

## 4. 공수·실패 처리·필요한 권한

| 구분 | [제안] 인일 | 전제·처리 |
| --- | --- | --- |
| 조사·비교 문서 | 0.5–1 | 공식 문서 조회 가능, 09 및 11 계약 기준 |
| 승인 후 샌드박스 검증 | 2–3 | 1인, 테스트 등록·격리 DB·RP 검증 환경 준비. 운영 배치, 운영 자격 및 완전한 종단 인수 시험 공수는 별도 |
| 부적합·검증 실패 | — | 부적합 기능과 근거를 기록하고 다른 후보 또는 RP 라이브러리와 OP 최소 직접 구현 조합을 재평가한다. 비용·보안 차이와 판정 보류 사유를 호배님께 보고한다. |

**필요한 권한**은 자비스가 호배님께 요청할 별도 코드 작성·crate 설치·샌드박스 실행 승인 및 테스트 등록 접근 권한이다. 이번 단계는 문서 비교와 검증 계획으로 제한한다. 코드 작성·crate 설치·실행 및 운영 설정 변경은 승인 후 작업이다.


## 5. 실행 결과

| 항목 | 값 |
| --- | --- |
| 실행 일시 | 2026-11-27 08:42–08:52 KST |
| 승인 | 호배님 2026-11-27 08:42 KST (자비스 전달: "어 테스트한다는거잖아? 진행해") |
| 실행 방법 | 설계 봇이 Mac Shell로 직접 실행. naru-orch·Codex 미사용. Claude 미사용. |
| 작업 경로 | `spike-lab/auth/` (`CARGO_TARGET_DIR`은 이 폴더의 `target/`) |
| 브랜치 | `feature/NARU-94-architecture`를 유지. 전환·커밋·push 없음. 기존 소스·전역 설정·`.env` 미변경. |
| 시험 호스트 | rustc 1.94.0 (4a4ef493e 2026-03-02), cargo 1.94.0, rustup stable-aarch64-apple-darwin. `rustup default` 및 `~/.cargo/config`는 변경하지 않았다. |

### 결론

샌드박스 기준으로 1순위 조합이 09 §4–5의 핵심 프로토콜 계약을 충족한다. 실 Google OAuth·HTTP 종단·DB 원자성은 이번 범위 밖이다.

### 고른 후보

나루 OP의 RS256 서명·JWKS·logout_token에는 `jsonwebtoken` 12.0.0(`rust_crypto`), Litpage RP의 PKCE S256·ID 토큰 검증(및 이후 Google RP 경로)에는 `openidconnect` 4.1.0을 쓴다.

### 근거

`jsonwebtoken`으로 서명한 RS256 ID 토큰을 `openidconnect` `CoreIdTokenVerifier`가 JWKS·`kid`로 검증했고, 잘못된 nonce·aud·iss·exp는 거부됐다. 활성·이전 키를 동시에 게시한 뒤 이전 `kid`를 내리면 해당 서명이 거부된다. 인가 코드는 PKCE `S256`과 일회 소비를 지키고, `logout_token`은 `events` 클레임을 가지며 `nonce`가 있으면 거부된다. 리프레시 토큰은 회전하고 재사용 시 계열을 폐기한다. 대안 `oauth-as` 1.1.0은 코드·S256·갱신 회전에 적합하지만 README가 OIDC OP가 아니라고 명시해 ID 토큰·UserInfo·백채널은 별도 구현이 남는다. `oauth2` 5.0.0은 `openidconnect`의 전이 의존으로 이미 포함되며, 단독으로는 ID 토큰 검증이 없어 Google RP 전체를 대체하지 않는다.

### 실제 버전

계획서 제안 버전과 Cargo.lock 해석 결과는 같다. 직접 지정한 부가 크레이트만 최신 마이너와 달랐다.

| 크레이트 | 계획 | 해석 결과 | 비고 |
| --- | --- | --- | --- |
| `openidconnect` | 4.1.0 | 4.1.0 | 라이선스 MIT, MSRV 1.88 |
| `jsonwebtoken` | 12.0.0 | 12.0.0 | 라이선스 MIT, MSRV 1.88, edition 2024. 기능 `rust_crypto`를 켰다. 기능이 없으면 `CryptoProvider`를 직접 등록해야 한다. |
| `oauth2` | 5.0.0 (비교·전이) | 5.0.0 | `openidconnect` 전이. MSRV 1.65, MIT OR Apache-2.0 |
| `oauth-as` | 1.1.0 (대안) | 1.1.0 | 별도 패키지 `alt-oauth-as`. MSRV 1.75, MIT OR Apache-2.0 |
| `base64` | (미지정) | 0.22.1 | 직접 의존. 잠금 파일에 0.23.1도 공존 |
| `sha2` | (미지정) | 0.10.9 | 직접 의존(PKCE). `jsonwebtoken`은 0.11.2를 따로 쓴다 |

결합 MSRV는 **1.88**이다. 이번 실행의 rustc 1.94.0은 이를 만족한다.

### 수치

| 항목 | 측정 |
| --- | --- |
| 최초 `cargo test --workspace` | 실시간 19.51초(crates.io 갱신·다운로드·의존성 컴파일 포함). 당시 소스 오류로 테스트는 실행되지 않음 |
| 오프라인 clean 재빌드 `cargo test --workspace --offline` | 실시간 11.78초(user 56.37, sys 7.69). 계약 테스트 본체 0.10초 |
| 테스트 | 12통과 0실패(본 패키지 계약 10, `oauth-as` 대안 2). 유닛·doctest 0건 |
| `Cargo.lock` | 고유 패키지 239, 버전 중복 포함 항목 271 |
| `cargo tree` 고유 이름 | 워크스페이스 201, 본 패키지 199, 대안 패키지 27 |
| `cargo audit` | 이 머신에 설치되어 있지 않아 실행하지 않음. 새로 설치하지 않음 |

### 확인한 계약과 테스트

- `op_signs_id_token_rs256_and_jsonwebtoken_verifies`
- `jwks_publishes_active_and_previous_kids_and_both_verify` (jsonwebtoken·openidconnect 모두)
- `jwks_after_previous_key_removed_rejects_old_kid`
- `rp_openidconnect_verifies_jsonwebtoken_signed_id_token`
- `rp_rejects_wrong_nonce_aud_iss_and_exp`
- `pkce_s256_match_and_mismatch`, `auth_code_pkce_s256_end_to_end_and_one_time_code` (등록 URI 불일치·코드 재사용 거부 포함)
- `logout_token_has_events_claim_and_no_nonce`, `logout_token_rejects_nonce_and_bad_signature`
- `refresh_rotates_and_reuse_revokes_family`
- 대안: `oauth-as` `pkce_s256_matches_and_rejects_mismatch` (RFC 7636 부록 B 검증기 길이의 대조 포함)

인메모리 OP/RP만 사용했다. 127.0.0.1 서버는 띄우지 않았고 Google 실서비스는 호출하지 않았다.

### 위험과 남은 범위

- Google 신규·기존 로그인, Discovery 현장 조회, HTTP authorize·token·UserInfo·백채널 전달·재시도, PostgreSQL 경합·원자성, JWKS 캐시 여유, 정지 차단 상한(Q-087), 기기별 로그아웃 전파 실측은 미실시. 11의 `TP-C-OIDC-LOGIN`·`TP-I-OIDC-GRANTS`·`TP-C-OIDC-KEYS` 종단은 후속 검증이다.
- `openidconnect`의 `CoreIdToken`은 표준 클레임만 검사한다. `sid`는 `jsonwebtoken` 클레임으로 확인했고, Litpage RP는 `AdditionalClaims`로 `sid`를 읽어야 한다.
- `logout_token` 헤더 `typ`은 `logout+jwt`로 발급했으나 `jsonwebtoken` Validation은 `typ`을 강제하지 않는다. RP 구현에서 헤더 검사를 보강할 수 있다.
- 리프레시 회전 계약은 `RefreshStore`로 검증했다. 인메모리 토큰 발행 경로의 세션 바인딩은 단순화되어 있다.
- 본 패키지 트리(고유 이름 199)는 `openidconnect`→`reqwest`/`rustls` 때문에 크다. OP 서명만 분리하면 더 얇아지지만, RP 검증·PKCE 타입 재사용 이점이 있다.
- `spike-lab/auth/keys/*.pem`은 합성 시험 키이며 운영 비밀이 아니다.

### 재현 명령

작업 폴더 안에서만 실행한다. `~/.cargo/bin`이 PATH에 없으면 `source "$HOME/.cargo/env"`만 하고, rustup 기본값이나 전역 설정은 바꾸지 않는다.

```bash
cd /Users/banghobae/Documents/2030-korea-stablepay/naru-architecture/spike-lab/auth
export CARGO_TARGET_DIR="$PWD/target"
cargo test --workspace
```
