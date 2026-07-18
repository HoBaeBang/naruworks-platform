# Home Server Architecture

NaruWorks는 홈서버 배포를 전제로 한다.

## 초기 런타임

```text
Internet
-> Router port forwarding
-> Home Server
-> Caddy
-> frontend
-> backend
-> PostgreSQL
```

## 후보 구성

| 컴포넌트 | 역할 |
| --- | --- |
| Caddy | reverse proxy, HTTPS |
| frontend | Next.js web |
| backend | Spring Boot API |
| postgres | platform database |
| backup script | DB dump, volume backup |
| health check | 서비스 상태 확인 |

## 운영 원칙

1. 홈서버는 public internet에 노출되므로 보안 설정을 먼저 고려한다.
2. 관리자 기능은 인증 없이는 접근할 수 없어야 한다.
3. DB backup과 restore 절차를 문서화한다.
4. deployment는 수동 복붙이 아니라 재현 가능한 script 또는 CI/CD로 한다.
5. 장애 시 확인할 로그 위치를 정해둔다.

## 나중에 추가할 것

```text
Prometheus / Grafana
centralized logs
alerting
zero-downtime deployment
offsite backup
```
