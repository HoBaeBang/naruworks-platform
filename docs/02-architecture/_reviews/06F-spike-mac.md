<!-- 06F 스파이크 Mac 직접 실행 보고. 실행: 설계 봇(Grok Bot 하위 작업), 2026-11-19 12:13~12:14 KST. 호배님 결정(2026-11-19 12:12 KST): "Mac에서 cargo build로 스파이크 돌려 줘 (sqlx 검증은 빼고)". 코드는 P2-2-06F-spike-codex-01이 작성한 /tmp/naru-06f-spike/ 그대로(코드 수정 없음). -->

# 06F 백엔드 스파이크 — Mac 직접 실행 결과

## 1. 환경
| 항목 | 값 |
|---|---|
| 일시 | 2026-11-19 12:13~12:14 KST |
| 장비 | 호배님 Mac, macOS 26.6.2 (25G83), arm64 |
| 도구 | `cargo 1.94.0 (85eff7c80 2026-01-15)`, `rustc 1.94.0 (4a4ef493e 2026-03-02)` (`~/.cargo/bin` 절대경로) |
| 크레이트 내려받기 | crates.io → `~/.cargo/registry` (호배님 승인) |
| 설치한 것 | 없음 (시스템 패키지·docker·PostgreSQL·sqlx-cli·전역 도구 설치 안 함) |
| PostgreSQL | 없음. sqlx는 `query_as` 런타임 쿼리 함수만 컴파일(실행 안 함, DB 불필요) |
| 빌드 | `cargo build --release`, 조합별 새 target 디렉터리(`results/target-<조합>-mac`) |
| 검증 스크립트 | `python3 verify.py <조합> <바이너리> --chunks 128` (Codex 작성, 수정 없음) |

## 2. 결과 표
| 항목 | A axum | B actix-web | 기준 |
|---|---|---|---|
| 서버 release 빌드 | 합격 | 합격 | 경고 없이 완료 |
| (a) 1 GiB 업로드 저장 바이트 | 합격 — 1,073,741,824 B (8 MiB × 128 청크) | 합격 — 1,073,741,824 B | 바이트 일치 |
| (a) SHA-256 일치 | 합격 — `ffa3d8fd…f0822` 원본=저장 | 합격 — 동일 | 일치 |
| (a) 서버 RSS 증가 ≤ 64 MiB (PV-003) | 합격 — 기준 6,928 KiB → 최고 12,640 KiB, **증가 5,712 KiB(≈5.6 MiB)**, 표본 138개 | 합격 — 기준 8,992 KiB → 최고 13,760 KiB, **증가 4,768 KiB(≈4.7 MiB)**, 표본 137개 | ≤ 65,536 KiB |
| (a) 1 GiB+1 B 거부 413 (PV-001) — 마지막 청크(127) 8 MiB+1 B, Content-Length 지정 | 합격 — 413 | 합격 — 413 | 413 |
| (a) 같은 조건, Transfer-Encoding: chunked (길이 미지정 스트림) | 합격 — 413, 기존 127번 청크 체크섬 불변 | 합격 — 413, 불변 | 413 + 기존 데이터 보존 |
| (a) 129번째 청크(128번) 1 B 거부 | 합격 — 413 | 합격 — 413 | 413 |
| (b) sqlx `query!` 컴파일 타임 검사 | **제외(호배님 결정)** | **제외(호배님 결정)** | — |
| (b) sqlx `query_as` 런타임 쿼리 컴파일 | 합격(컴파일만, 실행 안 함) | 합격(컴파일만) | 빌드 성공 |
| (c) utoipa OpenAPI JSON 생성·유효 | 합격 — `GET /openapi.json`, OpenAPI 3.1.0, `python3 -m json.tool` 통과, `PUT /uploads/{id}/chunks/{n}` 응답 204·400·413·500 | 합격 — 동일 | JSON 파싱 + 경로·응답 존재 |

## 3. 빌드 측정
| 항목 | A axum | B actix-web |
|---|---|---|
| `cargo fetch` | 6초 (첫 내려받기) | 1초 (A가 받은 공통 크레이트 재사용) |
| 클린 release 빌드 (새 target, 의존성 전체 컴파일) | 18.71초 | 22.61초 |
| 증분 release 빌드 (`touch src/main.rs` 후) | 1.71초 | 2.05초 |
| release 바이너리 크기 | 1,966,192 B (≈1.9 MiB) | 5,577,216 B (≈5.3 MiB) |
| target 디렉터리 크기 | 311 MB | 482 MB |
| 서버 구성 | tokio `current_thread` 런타임 | actix `workers(1)` |

## 4. Cargo.lock 해석 버전 (2026-11-19 기준 crates.io)
| 크레이트 | A | B |
|---|---|---|
| axum | 0.8.9 | — |
| axum-core | 0.5.6 | — |
| actix-web | — | 4.20.0 |
| actix-http | — | 3.22.0 |
| sqlx / sqlx-core / sqlx-postgres | 0.8.6 | 0.8.6 |
| utoipa | 5.5.0 | 5.5.0 |
| tokio | 1.54.1 | 1.54.1 |
| hyper | 1.12.0 | (actix는 hyper 미사용) |
| tower | 0.5.3 | — |
| futures-util | 0.3.34 | 0.3.34 |

## 5. 한계·해석 주의
- 업로드는 **한 번에 1건, 청크 순차 전송**이다. 동시 3건(PV-009의 백그라운드 업로드 조건)과 20 VU 부하에서의 RSS·p95는 측정하지 않았다.
- RSS는 `ps -o rss=` 약 25 ms 간격 표본 최고치다(연속 측정 아님). 원본 데이터는 `/dev/zero` + 청크 번호 8바이트라 압축·내용 의존 효과는 없다.
- 1 GiB 한도는 "청크 128개 × 청크당 최대 8 MiB" 구조로 강제한다. 업로드 전체 바이트 합계 원장(DB)·재개·조립(merge)은 구현하지 않았다.
- 서버는 로컬 루프백(127.0.0.1)·HTTP/1.1. 프록시(Cloudflare 등)·TLS 경유는 시험하지 않았다(GAP-005, U-13).
- 측정 환경은 macOS arm64. 운영 대상 OS에서의 RSS·성능 차이는 [미확인](U-16).
- sqlx `query!`(컴파일 타임 DB 검사)는 호배님 결정으로 제외. PostgreSQL 대상 시험은 하나도 실행하지 않았다.
- 크레이트의 유지보수 활동·라이선스 변경·취약점 이력은 여전히 확인하지 않았다(버전만 확정).

## 6. 정리
- 시험용 큰 파일 삭제: `data/a-axum/verify-*`, `data/b-actix/verify-*`(각 1 GiB), `results/*-verify-*/source.part`.
- 남긴 것: 소스, `Cargo.lock`, 측정 결과(`results/*-verify-*/metrics.json`, `openapi.json`, `openapi.pretty.json`), target 디렉터리(재실행용, 합계 약 793 MB — 필요 없으면 삭제 가능), 실행 로그 `results/mac-run.log`.
