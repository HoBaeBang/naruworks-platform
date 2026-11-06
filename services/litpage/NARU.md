# NaruWorks 수정 사항

이 디렉터리는 오픈소스 [Litpage](https://github.com/litmers-dev/litpage)(MIT, 씨그로 주식회사)를 복사해 NaruWorks에 맞게 수정한 것이다. 원본 `LICENSE`와 `THIRD_PARTY_NOTICES.md`는 그대로 유지한다.

- 원본 커밋: `931cd28` (2026-10-26)
- 원본은 "연구·데모용, as is" 프로젝트이며 업스트림 변경을 따라가지 않는다. 필요한 수정은 이 저장소에서 직접 한다.
- 이슈: [#76](https://github.com/HoBaeBang/naruworks-platform/issues/76)

## 인증 방침

로그인은 NaruWorks Keycloak(`naruworks` realm)의 OIDC 하나뿐이다. 회원(`member` 역할)만 들어오고, 회원마다 개인 작업공간을 받는다. Litpage에서 따로 가입하거나 로그인하지 않는다.

## 수정 목록 (원본 대비)

| 영역 | 변경 |
| --- | --- |
| `apps/server/src/oidc.ts` (신규) | Keycloak 로그인(authorization code + PKCE), `/auth/login`·`/auth/callback`·`/auth/logout`. 토큰 교환과 키 조회는 내부 주소(`NC_OIDC_INTERNAL_URL`), 브라우저 이동은 공개 주소(`NC_OIDC_ISSUER`). `member` 역할과 `email_verified`를 확인하고, Keycloak `sub`로 사용자를 찾거나 만든다(`idp_identities` 테이블). MCP용 `userFromBearer`도 여기에 있다. |
| `apps/server/src/auth.ts` | 세션 수명 365일 → 7일. 세션은 `oidc.ts`만 만든다. |
| `apps/server/src/api/handlers.ts`, `api/modules/account.ts` | 로그인 코드·비밀번호·2단계 인증·패스키 로그인 핸들러(`sendSignInCode`, `signInWithEmail`, `checkSignInMethods`, `changePassword`, `loginWithMfa`, `passkeyLoginOptions`, `loginWithPasskey`)가 410을 돌려준다. |
| `apps/server/src/app.ts` | OIDC 라우트를 등록하고, 세션이 없는 앱 셸 요청(`/public/…` 제외)을 `/auth/login`으로 보낸다. |
| `apps/server/src/demo.ts` | 공개 데모(`isDemoMode`)를 항상 끈다. |
| `apps/server/src/bootstrap.ts` | 삭제(초기 비밀번호 계정 생성 제거). `NC_BOOTSTRAP_*`는 더 이상 쓰이지 않는다. |
| `apps/web/src/App.tsx`, `lib/store/session.ts` | 로그인 화면 대신 `/auth/login`으로 이동하고, 로그아웃은 `/auth/logout`으로 이동한다. |
| `apps/server/package.json` | `jose` 추가(토큰 검증). |
| 테스트 | `naru-oidc.test.ts` 추가. 제거된 기능을 시험하던 테스트(데모, 비밀번호, 2단계 인증, 패스키 로그인)는 삭제하거나 410 확인으로 바꿨다. |

## 환경변수 (서버)

| 이름 | 설명 |
| --- | --- |
| `NC_OIDC_ISSUER` | 공개 issuer. 예: `https://idp.naruworks.com/realms/naruworks` |
| `NC_OIDC_INTERNAL_URL` | 서버가 토큰 교환·키 조회에 쓰는 내부 주소. 예: `http://keycloak:8080/realms/naruworks` |
| `NC_OIDC_CLIENT_ID`, `NC_OIDC_CLIENT_SECRET` | Keycloak 클라이언트 `litpage`. 비밀값은 환경변수로만 받는다. |
| `NC_PUBLIC_URL` | 공개 주소. 예: `https://litpage.naruworks.com` |
| `NC_OIDC_REQUIRED_ROLE` | 기본 `member` |
| `NC_OIDC_IDP_HINT` | 기본 `google` (Keycloak 화면 없이 Google로 이동) |
| `NC_OIDC_MCP_AUDIENCE` | MCP 토큰이 허용하는 추가 `aud`(쉼표로 구분) |

설정이 하나라도 빠지면 로그인이 불가능하다(닫힌 상태로 실패).

## 아직 안 한 일

- `/api/mcp`와 `/v1`의 개인 토큰(`lp_pat_…`) 인증을 Keycloak Bearer(`userFromBearer`)로 교체하고 PAT를 제거한다.
- 외부 공유 정리: 공개 링크만 남기고 게스트 초대, 사이트 게시, 공개 폼을 막는다. 이메일로 사용자 자리표시자를 만드는 초대 경로도 점검한다.
- compose 서비스, Keycloak realm 클라이언트(`litpage`), `.env.example`, 설계 문서.
- 실제 Keycloak에 붙인 로컬 종단 시험(Google 로그인, 정지된 회원 거부, 웹소켓, 로그아웃).
- 남은 죽은 코드(MFA, 패스키, 비밀번호 설정 화면)는 로그인에 쓰이지 않지만 코드는 남아 있다.

## 알려진 위험

- 세션 수명 7일: 회원이 정지돼도 최대 7일간 접속이 유지될 수 있다. 후속으로 로그인 갱신 시 역할 재확인 또는 Keycloak 백채널 로그아웃을 검토한다.
- 컨테이너 환경에서 원본 테스트 21개가 이미 실패한다(원본 이미지에서도 동일). 이번 변경으로 늘어난 실패는 없다.
