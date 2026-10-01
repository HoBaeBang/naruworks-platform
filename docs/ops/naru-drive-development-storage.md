# Naru Drive 개발용 Object Storage

## 목적

전용 HDD를 구매·장착하기 전에도 Naru Drive의 파일·폴더 기능을 개발할 수 있도록 Docker named volume 기반의 S3 호환 저장소를 제공한다.

이 구성은 **개발 전용**이다. 운영 사용자 파일의 유일한 저장소로 사용하지 않는다.

## 구성

| 항목 | 선택 |
| --- | --- |
| Object Storage | RustFS `1.0.0-rc.6` |
| S3 API | Docker Compose 내부 `rustfs:9000` |
| 관리 Console | 홈서버 loopback `127.0.0.1:9001` |
| 데이터 | `naruworks-drive-data` Docker named volume |
| 초기 버킷 | private `naru-drive` |

RustFS는 표준 S3 API와 AWS Signature V4를 지원한다. Drive backend는 RustFS 전용 API 대신 AWS S3 SDK 호환 API에만 의존한다.

초기 설계의 MinIO 공개 이미지와 저장소는 현재 유지 종료 상태이므로, 개발 기반에는 현재 유지되는 RustFS를 사용한다. S3 호환 계약을 유지하므로 향후 NAS, Backblaze B2, 다른 S3 호환 저장소로 이전할 때 Drive 도메인·API를 바꾸지 않는다.

## 환경 변수

홈서버 `.env`에는 아래 값을 추가한다. 실제 값은 Git에 올리지 않는다.

```env
NARU_DRIVE_S3_ENDPOINT=http://rustfs:9000
NARU_DRIVE_S3_BUCKET=naru-drive
NARU_DRIVE_S3_ACCESS_KEY=대문자_영문과_숫자로_만든_접근키
NARU_DRIVE_S3_SECRET_KEY=openssl_rand_base64_32로_생성한_비밀값
```

접근 키는 AWS Signature V4 credential scope에 사용되므로 `/` 없이 대문자 영문·숫자만 사용한다. 비밀값은 다음 명령으로 생성한다.

```bash
openssl rand -base64 32
```

## 실행과 확인

```bash
docker compose up -d rustfs-volume-permission rustfs rustfs-bucket-init
docker compose ps rustfs rustfs-bucket-init
docker compose logs rustfs-bucket-init --tail=100
```

정상 기준:

```text
naruworks-rustfs = healthy
naruworks-rustfs-bucket-init = exited (0)
```

Console은 **홈서버에서만** 아래 주소로 연다.

```text
http://127.0.0.1:9001
```

S3 API 포트 `9000`은 호스트에 publish하지 않는다. backend 컨테이너만 Docker 내부 주소 `http://rustfs:9000`으로 접근한다.

## 데이터 보존 한계

`naruworks-drive-data`는 `docker compose down` 뒤에도 남지만, 아래 작업이나 호스트 장애로 사라질 수 있다.

```bash
docker compose down -v
docker volume rm naruworks-platform_naruworks-drive-data
```

따라서 현재 volume에는 테스트 파일만 둔다. 전용 HDD가 준비되면 named volume을 `/srv/naruworks/drive-data` 같은 고정 host mount로 전환하고, 외부 Object Storage 백업과 복원 테스트를 추가한다.
