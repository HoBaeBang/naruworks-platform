<!-- naru-orch job=P2-2-06F-spike-codex-01 provider=codex model=gpt-6.2-sol cwd=architecture-worktree spike=/tmp/naru-06f-spike copied=2026-11-19T12:02:21+0900 (cp) -->



---

# 06F 백엔드 스파이크 결과

Axum과 Actix Web 스파이크를 `/tmp/naru-06f-spike/`에 작성했습니다. 공통 크기 제한의 Rust 테스트 3개가 통과했습니다. 두 조합 모두 `index.crates.io` DNS 조회에서 막혀 서버 빌드와 통합 검증은 건너뛰었습니다.

## 1. 환경

| 항목 | 확인 결과 |
|---|---|
| Cargo | `cargo 1.94.0 (85eff7c80 2026-01-15)` |
| rustc | `rustc 1.94.0 (4a4ef493e 2026-03-02)` |
| OS | macOS 26.6.2 (`25G83`), arm64 |
| PostgreSQL | `psql`, `postgres` 실행 파일을 PATH에서 찾지 못함. DB 서버 설치·실행 없음 |

## 2. 조합별 검증 결과

| 항목 | A axum | B actix-web | 근거(명령·측정값) |
|---|---|---|---|
| 8 MiB 청크 및 1 GiB 한도 로직 | 합격 | 합격 | 공통 `limits.rs`를 `rustc --test`로 실행해 3/3 통과. 127번 청크의 끝이 `1,073,741,824 B`임을 확인하고, 128번 청크와 8 MiB + 1 B를 거부 |
| 스트리밍 HTTP 업로드와 저장 바이트·SHA-256 일치 | 건너뜀 | 건너뜀 | 서버 빌드 차단. `verify.py`는 기본 128개 청크로 1 GiB를 전송하고 저장 바이트와 `shasum -a 256` 결과를 비교 |
| HTTP에서 1 GiB + 1 B 거부 | 건너뜀 | 건너뜀 | 서버 빌드 차단. `verify.py`는 마지막 청크의 고정 길이·청크 전송 초과 요청과 128번 청크의 1 B 요청에서 각각 HTTP 413을 확인하도록 작성 |
| 업로드당 RSS 증가 ≤ 64 MiB | 건너뜀 | 건너뜀 | 서버 빌드 차단. `verify.py`는 유휴 RSS를 기준으로 전송 중 `ps -o rss=`를 약 25 ms 간격으로 표본 수집 |
| SQLx `query!` 오프라인 컴파일 검사 | 건너뜀 | 건너뜀 | 해당 쿼리용 `.sqlx` 메타데이터, 검사용 PostgreSQL, `cargo-sqlx`가 현재 환경에 없음 |
| SQLx `query_as` 컴파일 | 건너뜀 | 건너뜀 | 공통 코드에 `PgPool`을 사용하는 `query_as::<_, (i64,)>` 예제를 작성. 의존성 해석에서 차단 |
| utoipa OpenAPI JSON | 건너뜀 | 건너뜀 | 두 프로젝트에 `#[utoipa::path]`와 `GET /openapi.json`을 작성. 서버 빌드가 막혀 `python3 -m json.tool`로 생성 문서를 검사하지 못함 |

한 업로드 ID는 0~127번 청크만 저장할 수 있고 각 청크는 최대 8 MiB입니다. 두 핸들러는 프레임마다 누적 길이를 검사하고 임시 파일에 기록한 뒤, 본문 처리가 완료되면 해당 청크 파일로 이름을 바꾸도록 작성했습니다.

## 3. 측정값과 의존성

| 항목 | A axum | B actix-web |
|---|---|---|
| 클린 빌드 시간 | [미확인] | [미확인] |
| 유휴·최대 RSS 및 증가량 | [미확인] | [미확인] |
| 업로드 바이트 수 및 SHA-256 | [미확인] | [미확인] |
| Rust 소스 줄 수 (`wc -l`) | 전용 84줄 + 공통 187줄 = 271줄 | 전용 76줄 + 공통 187줄 = 263줄 |

두 프로젝트 모두 `Cargo.lock`이 생성되지 않았습니다. 아래 값은 `Cargo.toml`에 지정한 버전 범위이며, 실제 해석된 버전은 [미확인]입니다.

| 크레이트 | A 지정 범위 | B 지정 범위 |
|---|---:|---:|
| `axum` | `0.8` | — |
| `actix-web` | — | `4` |
| `sqlx` | `0.8` | `0.8` |
| `utoipa` | `5` | `5` |
| `tokio` | `1` | `1` |

## 4. 핵심 핸들러

**A · Axum**

```rust
async fn put_chunk(
    Path((id, n)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Result<StatusCode, AxumError> {
    let length = headers
        .get(header::CONTENT_LENGTH)
        .map(|value| value.to_str())
        .transpose()
        .map_err(|_| UploadError::InvalidRequest)?;
    let mut chunk = DiskChunk::open(FsPath::new(DATA), &id, &n, length).await?;
    let mut stream = body.into_data_stream();

    while let Some(frame) = stream.next().await {
        let frame = frame.map_err(|_| UploadError::InvalidRequest)?;
        chunk.append(&frame).await?;
    }

    chunk.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
```

**B · Actix Web**

```rust
async fn put_chunk(
    request: HttpRequest,
    path: web::Path<(String, String)>,
    mut payload: web::Payload,
) -> HttpResponse {
    let (id, n) = path.into_inner();
    let result = async {
        let length = request
            .headers()
            .get(header::CONTENT_LENGTH)
            .map(|value| value.to_str())
            .transpose()
            .map_err(|_| UploadError::InvalidRequest)?;
        let mut chunk = DiskChunk::open(Path::new(DATA), &id, &n, length).await?;
        while let Some(frame) = payload.next().await {
            let frame = frame.map_err(|_| UploadError::InvalidRequest)?;
            chunk.append(&frame).await?;
        }
        chunk.commit().await
    }
    .await;

    match result {
        Ok(()) => HttpResponse::NoContent().finish(),
        Err(error) => {
            let (status, message) = error.status_and_message();
            let status = StatusCode::from_u16(status).expect("known response status");
            HttpResponse::build(status).body(message)
        }
    }
}
```

## 5. 막힌 점과 필요한 권한·설치

- **필요한 권한**은 Cargo가 `index.crates.io`를 DNS로 조회하고 crates.io의 인덱스와 패키지를 다운로드할 수 있는 네트워크 접근입니다. `cargo fetch`는 두 조합 모두 `Could not resolve host: index.crates.io`로 종료됐습니다. 격리된 Cargo 캐시로 오프라인 빌드도 확인했으며 `axum`, `actix-web`을 각각 찾지 못했습니다. 권한 상승과 우회는 시도하지 않았습니다.
- **필요한 설치**는 업로드, `query_as` 컴파일, OpenAPI 검증에는 추가 시스템 패키지가 확인되지 않았습니다. `query!`는 정확히 일치하는 `.sqlx` 메타데이터를 제공받으면 설치 없이 재검증할 수 있습니다. 새로 생성하려면 PostgreSQL 검증 환경과 `sqlx-cli`가 필요하므로 이번 범위에서 건너뛰었습니다.

## 6. 스파이크 파일 위치

- [A Axum 소스](/tmp/naru-06f-spike/a-axum/src/main.rs:32), [B Actix Web 소스](/tmp/naru-06f-spike/b-actix/src/main.rs:25)
- [공통 디스크 쓰기 및 SQLx 예제](/tmp/naru-06f-spike/upload.rs), [크기 제한 및 테스트](/tmp/naru-06f-spike/limits.rs)
- [클린 빌드 스크립트](/tmp/naru-06f-spike/build.sh), [업로드·RSS·OpenAPI 검증 스크립트](/tmp/naru-06f-spike/verify.py)
- 업로드 저장 경로는 `/tmp/naru-06f-spike/data/`입니다.

이번 작업에서 생성하거나 수정한 파일은 모두 `/tmp/naru-06f-spike/` 아래에 있습니다. 저장소 파일은 변경하지 않았으며 Git 명령을 실행하거나 `.env*` 파일을 열지 않았습니다.