ㅊ# Cloudflared Docker Compose Runtime

## 목적

Cloudflare Tunnel 연결 프로그램인 `cloudflared`를 수동 명령이 아니라 Docker Compose 서비스로 관리한다.

이렇게 하면 홈서버에서 아래 명령 하나로 NaruWorks 실행 요소를 함께 관리할 수 있다.

```powershell
docker compose up -d --build
```

관리 대상:

```text
postgres
backend
frontend
cloudflared
```

## 필요한 값

홈서버의 루트 `.env` 파일에 Cloudflare Tunnel token을 추가한다.

```env
CLOUDFLARED_TUNNEL_TOKEN=Cloudflare에서 발급한 실제 토큰
```

주의:

```text
실제 token은 Git에 올리지 않는다.
.env.example에는 예시값만 둔다.
```

## Cloudflare Public Hostname 설정

`cloudflared`를 Windows에 직접 실행할 때는 Public Hostname의 service URL을 아래처럼 둘 수 있다.

```text
http://localhost:3000
```

하지만 `cloudflared`를 Docker Compose 안에서 실행하면 `localhost`는 cloudflared 컨테이너 자신을 의미한다.
따라서 frontend 컨테이너로 연결하려면 Docker Compose 서비스 이름을 사용해야 한다.

변경 후 설정:

```text
app.naruworks.com -> http://frontend:3000
```

Cloudflare 설정 경로:

```text
Cloudflare Dashboard
-> Zero Trust
-> Networks
-> Tunnels
-> naruworks-home
-> Public Hostname
-> app.naruworks.com
-> Service URL을 http://frontend:3000 으로 변경
```

## 실행 방법

홈서버에서 최신 코드를 받은 뒤 실행한다.

```powershell
git pull origin main
docker compose down
docker compose up -d --build
docker compose ps
```

정상 컨테이너:

```text
naruworks-postgres
naruworks-backend
naruworks-frontend
naruworks-cloudflared
```

## 확인 방법

Tunnel 컨테이너 로그:

```powershell
docker compose logs cloudflared --tail=200
```

Cloudflare Zero Trust에서 tunnel 상태가 `Healthy`인지 확인한다.

외부 접속 확인:

```text
https://app.naruworks.com
https://app.naruworks.com/calendar
```

Calendar에서는 생성, 수정, 삭제까지 확인한다.

## 주의사항

`CLOUDFLARED_TUNNEL_TOKEN`이 비어 있거나 잘못되면 cloudflared 컨테이너가 정상 연결되지 않는다.

Cloudflare Public Hostname이 여전히 `http://localhost:3000`이면 cloudflared 컨테이너 기준의 localhost를 바라보게 되어 접속이 실패할 수 있다.

운영 DB 데이터가 생긴 뒤에는 아래 명령을 조심한다.

```powershell
docker compose down -v
```

`-v`는 PostgreSQL volume까지 삭제할 수 있다.
