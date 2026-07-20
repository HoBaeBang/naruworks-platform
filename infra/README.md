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

## Local Docker Compose

로컬 Docker Compose는 프로젝트 루트에서 실행합니다.

```bash
cd /Users/banghobae/Documents/2030-korea-stablepay/naruworks-platform
```

### 전체 실행

이미지를 빌드하고 frontend, backend, PostgreSQL을 함께 실행합니다.

```bash
docker compose up --build
```

백그라운드에서 실행하려면 `-d`를 붙입니다.

```bash
docker compose up --build -d
```

기본 접속 주소:

```text
frontend: http://localhost:3000
backend:  http://localhost:8081
postgres: localhost:5432
```

### 상태 확인

```bash
docker compose ps
```

### 로그 확인

전체 로그:

```bash
docker compose logs -f
```

특정 서비스 로그:

```bash
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f postgres
```

### 종료

컨테이너를 종료하고 제거합니다. PostgreSQL 데이터 볼륨은 유지됩니다.

```bash
docker compose down
```

### 다시 빌드해서 실행

Dockerfile, Gradle, npm dependency, 빌드 설정을 바꾼 뒤에는 다시 빌드합니다.

```bash
docker compose up --build
```

백그라운드 실행 중인 컨테이너를 다시 빌드하려면:

```bash
docker compose up --build -d
```

### 특정 서비스만 재시작

```bash
docker compose restart frontend
docker compose restart backend
docker compose restart postgres
```

특정 서비스만 다시 빌드해서 실행:

```bash
docker compose up --build frontend
docker compose up --build backend
```

### API 확인

```bash
curl http://localhost:8081/api/health
curl http://localhost:8081/api/projects
curl http://localhost:8081/api/services
```

### 환경 변수

샘플 환경 변수는 루트의 `.env.example`을 기준으로 합니다.

```bash
cp .env.example .env
```

로컬 기본값만으로도 Docker Compose는 실행됩니다. 실제 운영 값이나 개인 환경 값은 `.env`에 작성하고 Git에 올리지 않습니다.

### 포트 충돌

이미 로컬에서 Next.js dev server나 Spring Boot가 떠 있으면 포트 충돌이 날 수 있습니다.

```bash
lsof -i :3000
lsof -i :8081
```

해당 프로세스를 종료하거나, 개발 서버 터미널에서 `Ctrl+C`를 누른 뒤 다시 실행합니다.

### PostgreSQL 데이터 초기화

DB 데이터까지 삭제하려면 볼륨을 함께 제거합니다.

```bash
docker compose down -v
```

주의: `-v`는 PostgreSQL 데이터 볼륨을 삭제합니다. 운영 또는 보존해야 하는 데이터가 있을 때는 사용하지 않습니다.
