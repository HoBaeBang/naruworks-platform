# NaruWorks Platform Overview

NaruWorks는 여러 개인 웹/앱 서비스를 한 홈서버에서 운영하기 위한 플랫폼이다.

## 큰 그림

```text
Users / Friends / Admin
-> NaruWorks Web
-> Platform API
-> PostgreSQL
-> Service Modules
-> StablePay Integration
-> Home Server Runtime
```

## 주요 영역

| 영역 | 책임 |
| --- | --- |
| Public Site | 프로젝트, 서비스, 포트폴리오를 보여준다 |
| Platform API | 사용자, 서비스, 신청, 관리자 기능을 제공한다 |
| Admin Dashboard | 서비스 상태, 요청, 결제/정산 상태를 관리한다 |
| Service Modules | 실제 웹/앱 서비스 기능을 추가하는 영역 |
| StablePay Integration | 결제, 원장, 정산 기능을 연결한다 |
| Home Server Ops | 배포, proxy, HTTPS, 백업, 로그, 모니터링을 담당한다 |

## 1차 목표 아키텍처

```text
Browser
-> Caddy
-> Next.js frontend
-> Spring Boot platform-api
-> PostgreSQL
```

StablePay는 초기에는 외부 모듈로 둔다.

```text
platform-api
-> stablepay-adapter
-> StablePay API 또는 payment module
```

## 설계 기준

1. frontend와 backend는 분리하지만 같은 monorepo에서 관리한다.
2. 홈서버 배포를 기본 목표로 둔다.
3. 처음에는 Docker Compose로 운영한다.
4. Kubernetes는 실제 운영 문제가 생긴 뒤 검토한다.
5. 모든 주요 기능은 README와 docs에 운영 가능한 형태로 기록한다.
