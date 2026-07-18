# NaruWorks Infra

홈서버 배포와 로컬 실행에 필요한 파일을 둡니다.

초기 구성 후보:

```text
docker-compose.yml
caddy/Caddyfile
scripts/backup-postgres.sh
scripts/deploy.sh
```

처음 목표는 Kubernetes가 아니라 재현 가능한 Docker Compose 운영입니다.
