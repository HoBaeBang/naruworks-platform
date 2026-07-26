# 2026-07-26 홈서버 첫 배포 회고

## 배경

NaruWorks는 개인 홈서버에서 운영할 브랜드형 서비스 플랫폼이다.

이번 배포의 목표는 로컬 개발 환경을 넘어 실제 도메인으로 접속 가능한 첫 운영 환경을 만드는 것이었다.

```text
https://app.naruworks.com
```

첫 배포 대상은 Naru Home과 Naru Calendar의 초기 기능이다.

## 배포 결과

완료된 내용:

```text
1. naruworks.com 도메인 구매
2. Cloudflare 기반 외부 접속 구조 선택
3. Windows 홈서버 PC에 Git, Docker Desktop 설치 확인
4. GitHub repository clone
5. Docker Compose로 frontend, backend, postgres 실행
6. Cloudflare Tunnel로 app.naruworks.com 연결
7. 외부 도메인에서 NaruWorks 화면 표출 확인
8. Naru Calendar 저장 실패 원인 분석 및 프록시 구조로 개선
```

현재 운영 구조:

```text
사용자 브라우저
  -> https://app.naruworks.com
  -> Cloudflare
  -> Cloudflare Tunnel
  -> Windows 홈서버
  -> frontend container
  -> backend container
  -> postgres container
```

## 네트워크 판단

ipTIME 공유기의 외부 IP가 `192.168.13.x` 형태로 확인되었다.

이는 공인 IP가 아니라 사설 IP 대역이다.
따라서 ipTIME 공유기가 인터넷에 직접 붙어 있는 구조가 아니라 상위 공유기, 통신사 장비, 건물망, CGNAT 등 다른 네트워크 뒤에 있을 가능성이 높다고 판단했다.

이 상태에서 일반 포트포워딩을 쓰려면 아래 중 하나가 필요하다.

```text
1. 상위 장비 브릿지 모드 설정
2. 상위 장비와 ipTIME의 이중 포트포워딩
3. 통신사에 공인 IP 요청
```

초기 운영 단계에서는 네트워크 변수와 보안 부담이 크기 때문에 포트포워딩 방식은 보류하고 Cloudflare Tunnel 방식을 선택했다.

## Cloudflare Tunnel을 선택한 이유

Cloudflare Tunnel은 홈서버가 Cloudflare 쪽으로 outbound 연결을 만들고, 외부 사용자는 Cloudflare를 통해 홈서버에 접근하는 방식이다.

선택 이유:

```text
1. 공유기 포트포워딩이 필요 없다.
2. 공인 IP가 없어도 외부 도메인 접속이 가능하다.
3. HTTPS 구성을 Cloudflare에서 자연스럽게 처리할 수 있다.
4. 홈서버의 80/443 포트를 직접 열지 않아도 된다.
5. 현재 사설 WAN IP 환경과 잘 맞는다.
```

초기 Public Hostname은 아래로 설정했다.

```text
app.naruworks.com -> http://localhost:3000
```

이 설정에서 `http://localhost:3000`은 사용자 브라우저 기준이 아니라 홈서버에서 실행 중인 `cloudflared` 기준의 로컬 서비스다.
외부 사용자는 `https://app.naruworks.com`으로 접속하므로 외부 구간은 HTTPS다.

## Docker Compose 이슈와 해결

초기 Docker Compose 실행에서 backend가 정상 기동되지 않는 문제가 있었다.

원인은 backend 컨테이너가 postgres 컨테이너와 같은 DB 환경변수를 받지 못한 점이었다.

postgres는 아래 값을 받았다.

```text
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
```

하지만 backend는 `SPRING_PROFILES_ACTIVE`만 받고 있었다.
그 결과 `.env` 값과 Spring의 기본 fallback 값이 어긋나면 backend가 실제 postgres 계정과 다른 계정으로 접속하려 했다.

해결:

```yaml
backend:
  environment:
    SPRING_PROFILES_ACTIVE: ${SPRING_PROFILES_ACTIVE:-docker}
    POSTGRES_DB: ${POSTGRES_DB:-naruworks_local}
    POSTGRES_USER: ${POSTGRES_USER:-naruworks_local}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-change_me_local_password}
```

이후 홈서버에서 Docker Compose 기반 화면 표출까지 확인했다.

## Calendar 저장 실패 이슈와 해결

배포 후 Naru Calendar 화면은 보였지만 일정 저장 시 아래 메시지가 표시되었다.

```text
일정을 저장하지 못했습니다. 입력값을 확인해주세요.
```

원인은 frontend 코드의 실행 위치 차이였다.

월간 일정 조회는 Next.js 서버 컴포넌트에서 실행되므로 Docker 내부 주소를 사용할 수 있다.

```text
frontend container -> http://backend:8080 -> backend container
```

하지만 일정 생성/수정/삭제 모달은 `"use client"` 컴포넌트다.
따라서 저장 요청은 사용자 브라우저에서 실행된다.

기존 fallback 주소는 아래와 같았다.

```text
http://localhost:8081
```

외부 사용자의 브라우저에서 `localhost`는 홈서버가 아니라 사용자의 기기 자신을 의미한다.
그래서 배포 환경에서 저장 요청이 실패했다.

해결 방향은 Next.js API Route 프록시다.

변경 후 흐름:

```text
사용자 브라우저
  -> https://app.naruworks.com/api/calendar/events
  -> frontend container
  -> http://backend:8080/api/calendar/events
  -> backend container
```

추가된 frontend proxy route:

```text
frontend/src/app/api/calendar/events/route.ts
frontend/src/app/api/calendar/events/[id]/route.ts
```

이 구조를 통해 backend를 외부에 직접 노출하지 않고, 브라우저 요청은 같은 도메인으로 처리할 수 있게 되었다.

## 배운 점

1. 홈서버 배포에서는 애플리케이션 코드보다 네트워크 구조 확인이 먼저다.
2. 공유기 외부 IP가 사설 IP라면 단순 포트포워딩으로 해결되지 않을 수 있다.
3. Cloudflare Tunnel은 사설망/CGNAT 환경의 개인 홈서버에 잘 맞는다.
4. Docker Compose에서 DB 환경변수는 DB 컨테이너와 애플리케이션 컨테이너 양쪽에 일관되게 전달해야 한다.
5. Next.js에서는 서버 컴포넌트와 클라이언트 컴포넌트의 실행 위치 차이를 항상 고려해야 한다.
6. 브라우저에서 실행되는 API 호출에 `localhost`를 쓰면 배포 환경에서 실패할 가능성이 높다.
7. backend를 외부에 직접 공개하지 않고 frontend 프록시를 통해 접근시키는 구조가 현재 NaruWorks에 더 적합하다.

## 보완할 점

### 1. 배포 절차 문서화

현재는 수동으로 Windows 홈서버에 접속해 `git pull` 후 Docker Compose를 다시 실행한다.
이 흐름을 문서화해야 한다.

필요 문서:

```text
docs/ops/home-server-deploy-guide.md
```

포함할 내용:

```text
1. Windows 홈서버 준비
2. Git clone / pull
3. .env 작성
4. docker compose up -d --build
5. 로그 확인
6. Cloudflare Tunnel 확인
7. 장애 시 점검 순서
```

### 2. 자동 배포 구성

장기적으로는 GitHub에 push하면 홈서버가 자동으로 배포되도록 구성해야 한다.

초기 추천 방식:

```text
GitHub Actions self-hosted runner
```

예상 흐름:

```text
git push origin main
  -> GitHub Actions
  -> Windows 홈서버 self-hosted runner
  -> git pull
  -> docker compose up -d --build
```

초기에는 현재 수동 배포 폴더인 `C:\naruworks\naruworks-platform`에서 실행하는 방식이 이해하기 쉽다.

### 3. 운영 환경변수 정리

현재 `.env.example`은 운영값과 혼동될 수 있다.
운영용 `.env`는 Git에 올리지 않고 홈서버에만 둬야 한다.

정리할 항목:

```text
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
SPRING_PROFILES_ACTIVE
CATALOG_API_BASE_URL
CALENDAR_API_BASE_URL
```

운영 기본값과 예시값은 분리하는 것이 좋다.

### 4. cloudflared 실행 방식 정리

현재는 Cloudflare Tunnel을 먼저 수동으로 연결했다.
앞으로는 선택지가 있다.

```text
1. Windows 서비스로 cloudflared 실행
2. Docker Compose에 cloudflared 컨테이너 포함
```

NaruWorks 전체를 compose 하나로 관리하려면 2번이 좋다.
다만 Cloudflare token 관리가 필요하므로 `.env`와 secret 관리 방식을 먼저 정해야 한다.

### 5. DB 백업 전략

운영 데이터가 생기면 `docker compose down -v`를 절대 가볍게 실행하면 안 된다.
PostgreSQL volume 백업 정책이 필요하다.

초기 백업 후보:

```text
1. pg_dump 수동 백업
2. Windows 작업 스케줄러 기반 정기 백업
3. 백업 파일을 외장 디스크 또는 개인 Drive에 복사
```

### 6. 로그와 장애 대응

현재 장애 확인은 `docker compose logs`에 의존한다.
초기 운영에서는 충분하지만, 최소한의 점검 명령은 문서화해야 한다.

기본 명령:

```powershell
docker compose ps
docker compose logs backend --tail=200
docker compose logs frontend --tail=200
docker compose logs postgres --tail=200
```

### 7. 보안 기준 정리

현재는 개인 서비스 초기 단계라 인증/권한 체계가 없다.
외부 도메인으로 배포된 만큼 최소 보안 기준이 필요하다.

우선순위:

```text
1. 관리자 기능은 외부 공개 전 인증 필수
2. backend 직접 공개 금지
3. DB 포트 외부 공개 금지
4. Cloudflare Access 적용 검토
5. Calendar 개인 데이터 보호 기준 정리
```

## 다음 진행 작업

추천 순서:

```text
1. Calendar API 프록시 변경사항 커밋/푸시
2. Windows 홈서버에서 git pull 후 docker compose up -d --build
3. app.naruworks.com에서 Calendar 생성/수정/삭제 재검증
4. 홈서버 수동 배포 가이드 작성
5. GitHub Actions self-hosted runner 기반 자동 배포 구성
6. 운영 .env와 secret 관리 기준 정리
7. PostgreSQL 백업 절차 초안 작성
```

기능 개발 측면의 다음 작업:

```text
1. Naru Calendar UI 안정화
2. 주간/일간/연간 보기 기획 구체화
3. 대한민국 공휴일/음력 표시 방식 조사
4. 반복 일정 도메인 설계
5. Google Calendar 연동 방식 조사
```

운영 측면에서는 자동 배포와 백업이 먼저다.
외부 배포가 시작된 이상, 기능을 더 얹기 전에 배포 반복성과 데이터 보호를 먼저 잡는 것이 좋다.
