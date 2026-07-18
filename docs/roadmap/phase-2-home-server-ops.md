# Phase 2 - Home Server Ops

목표는 NaruWorks를 홈서버에서 재현 가능하게 배포하고 운영하는 것이다.

## 완료 기준

```text
홈서버에서 docker compose로 서비스가 뜬다.
Caddy reverse proxy를 통해 접속할 수 있다.
HTTPS 구성이 문서화된다.
배포 script 또는 CI/CD가 동작한다.
DB backup 절차가 있다.
health check와 기본 로그 확인 절차가 있다.
```

## 작업 후보

| 작업 | 설명 |
| --- | --- |
| Docker Compose | frontend, backend, postgres 실행 |
| Caddy | reverse proxy, HTTPS |
| Environment | local/prod env 분리 |
| CI/CD | GitHub Actions 또는 self-hosted runner |
| Backup | PostgreSQL dump script |
| Health Check | backend health endpoint, frontend status |
| Logs | container logs 확인 절차 |

## 주의점

처음부터 Kubernetes로 가지 않는다. 홈서버에서 실제로 운영하면서 Docker Compose의 한계를 만났을 때 확장한다.
