# NaruWorks Platform Overview

NaruWorks는 직접 제공하는 서비스(드라이브, 문서관리, 캘린더)와 NaruWorks 회원 정보로 연동한 오픈소스 서비스를 함께 제공하는 플랫폼이다. 오픈소스로 만든 결과물은 나루 드라이브에 쌓인다. 방향의 배경은 [ADR 0002](../decisions/0002-open-source-service-platform.md)에 있다.

## 큰 그림

```text
사용자
-> NaruWorks (회원·인증 / 오픈소스 카탈로그 / 나루 드라이브 / 직접 서비스)
-> 오픈소스 서비스 A, B, C ... (NaruWorks 로그인으로 연결)
-> 결과물은 나루 드라이브에 저장
```

README의 [서비스 제공 흐름](../../README.md#사용자에게-서비스를-제공하는-흐름)과 [연동 구조](../../README.md#핵심-구조) 그림이 같은 내용이다.

## 주요 영역

| 영역 | 책임 | 상태 |
| --- | --- | --- |
| 회원·인증 | 소셜 로그인, 회원 가입·승인, 역할과 상태. Keycloak(OIDC)이 로그인을 맡는다 | 운영 중 |
| 직접 서비스 | Naru Calendar, 나루 드라이브, 문서관리 | Calendar 운영, Drive 개발 중 |
| 오픈소스 카탈로그 | 연동된 오픈소스 목록, 사용 신청, 연동 심사 | 설계 전 |
| 오픈소스 서비스 | NaruWorks 로그인과 화면 규칙을 따르는 외부 오픈소스. 첫 대상은 Litpage | 연동 중 |
| 나루 드라이브 | 모든 서비스의 결과물 저장. 기본 5GB 무료, 이후 요금제 | 개발 중 |
| 홈서버 운영 | 배포, 터널, HTTPS, 백업, 로그, 모니터링 | 운영 중 |

## 런타임 구조

```text
Browser
-> Cloudflare Tunnel
-> Next.js frontend
-> Spring Boot platform-api
-> PostgreSQL
```

오픈소스 서비스는 같은 Docker Compose 안에 별도 서비스로 두고 외부 포트를 열지 않는다. 인증은 Keycloak이 맡는다. 서비스별 세션과 로그아웃을 정리하는 방식은 [오픈소스 서비스 연동 기준](open-source-integration.md)에 있다.

## 설계 기준

1. frontend와 backend는 분리하지만 같은 monorepo에서 관리한다.
2. 홈서버 배포를 기본 목표로 둔다.
3. 처음에는 Docker Compose로 운영한다.
4. Kubernetes는 실제 운영 문제가 생긴 뒤 검토한다.
5. 모든 주요 기능은 README와 docs에 운영 가능한 형태로 기록한다.
6. 서비스가 10개 이상으로 늘 수 있다고 전제하고, 서비스를 하나 붙일 때마다 인증과 화면 연동을 반복하지 않는 구조를 목표로 한다.
