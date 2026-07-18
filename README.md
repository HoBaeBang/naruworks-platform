# NaruWorks Platform

NaruWorks는 개인 홈서버 위에서 여러 웹/앱 서비스를 직접 기획, 개발, 배포, 운영하기 위한 개인 서비스 플랫폼입니다.

이 프로젝트는 단순 포트폴리오 사이트가 아니라, 실제로 사용할 수 있는 서비스들을 하나씩 올리고 운영 경험을 쌓기 위한 장기 프로젝트입니다. StablePay는 이 플랫폼 안에서 결제, 원장, 정산 기능을 담당하는 금융 모듈 또는 외부 결제 서비스로 연결합니다.

```text
NaruWorks Platform
-> Portfolio / Service Hub
-> Auth / Admin / User
-> Web & App Services
-> Home Server Operations
-> StablePay Payment / Ledger / Settlement
```

## 목표

- 내가 만든 프로젝트와 서비스를 한곳에서 보여주는 전용 사이트를 구축한다.
- 직접 기획한 웹/앱 서비스를 만들고 지인들이 실제로 사용할 수 있게 운영한다.
- 프론트엔드, 백엔드, 데이터베이스, 인프라, CI/CD, 모니터링까지 end-to-end로 경험한다.
- StablePay의 결제/원장/정산 기능을 플랫폼의 유료 기능, 크레딧, 정산 흐름에 연결한다.
- 한국 백엔드 채용 시장에서 설명 가능한 Spring Boot 기반 운영형 포트폴리오를 만든다.

## 초기 기술 방향

| 영역 | 선택 |
| --- | --- |
| Frontend | Next.js, TypeScript |
| Backend | Java 21, Spring Boot |
| Database | PostgreSQL |
| Infra | Docker Compose, Caddy |
| CI/CD | GitHub Actions 또는 self-hosted runner |
| Observability | health check, structured logs, 이후 Prometheus/Grafana |
| Payment module | StablePay 연동 또는 Spring 재구현 |

## 초기 구조

```text
naruworks-platform/
  README.md
  docs/
    프로젝트_운영_메모리.md
    architecture/
      platform-overview.md
      home-server-architecture.md
      service-boundaries.md
    roadmap/
      phase-1-platform-core.md
      phase-2-home-server-ops.md
      phase-3-stablepay-integration.md
    decisions/
      0001-project-name-and-direction.md
  backend/
    README.md
  frontend/
    README.md
  infra/
    README.md
    caddy/
    scripts/
  services/
    README.md
```

## Phase

```text
Phase 1: Platform Core
-> NaruWorks 사이트, 사용자/관리자 기본 구조, 프로젝트/서비스 허브

Phase 2: Home Server Ops
-> Docker Compose, reverse proxy, HTTPS, CI/CD, 백업, 로그, health check

Phase 3: StablePay Integration
-> 결제 요청, 크레딧/포인트, ledger, settlement, admin 정산 화면

Phase 4: Real Services
-> 지인 또는 나 자신이 실제로 사용하는 작은 웹/앱 서비스들을 추가
```

## StablePay와의 관계

StablePay는 NaruWorks 안에 무리하게 합치지 않습니다. 먼저 독립 결제/원장 기준 구현으로 유지하고, NaruWorks에서는 adapter 또는 API 연동 형태로 사용합니다.

```text
NaruWorks
-> 서비스/사용자/관리자/운영 플랫폼

StablePay
-> 결제/원장/정산/입출금 모듈
```

나중에 Spring Boot 재구현을 진행할 때는 Go StablePay에서 검증한 도메인 규칙을 NaruWorks payment module 또는 별도 Spring payment service로 옮깁니다.

## Codex 작업 방식

새 대화에서 이 프로젝트를 이어서 작업할 때는 먼저 아래 문서를 읽습니다.

```text
docs/프로젝트_운영_메모리.md
```

그 다음 README, architecture, roadmap 문서를 확인하고 현재 Phase의 작은 단위 작업부터 진행합니다.
