# 오픈소스 서비스 플랫폼 로드맵

작성일: 2026-11-12

방향은 [ADR 0002](../decisions/0002-open-source-service-platform.md), 연동 기준은 [오픈소스 서비스 연동 기준](../architecture/open-source-integration.md)을 따른다. 기존 `phase-1`~`phase-3` 문서는 초기 기획(개인 홈서버 포털과 StablePay 중심)의 기록이며, 새 방향의 단계는 이 문서를 기준으로 한다.

상태는 2026-11-12 기준이다.

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| 0. 기반 | Keycloak 중앙 로그인(Google), 회원 가입·승인, Naru Calendar | 운영 중 |
| 1. 인증 구조 정리 | 로그아웃 전체 통일, SSO 7일, 회원 정지 반영(Back-channel), 새 서비스용 공통 게이트 결정 | 논의 중 ([#80](https://github.com/HoBaeBang/naruworks-platform/issues/80)) |
| 2. 나루 드라이브 MVP | 폴더 조회·생성, 이름 변경, 이동까지 구현. 업로드·다운로드와 저장소 연결, 5GB 한도 | 진행 중 ([#77](https://github.com/HoBaeBang/naruworks-platform/issues/77) 등) |
| 3. 첫 오픈소스 Litpage 마무리 | MCP Bearer 인증, 공유 제한, compose·realm 클라이언트, 도메인 공개, 드라이브 연동 | 진행 중 ([#76](https://github.com/HoBaeBang/naruworks-platform/issues/76)) |
| 4. 카탈로그와 신청 | 오픈소스 목록 화면, 사용 신청, 연동 심사 절차, 하단 가이드라인 | 설계 전 |
| 5. 요금제 | 5GB 초과 드라이브 요금제, 결제 방식 | 설계 전. 결제 수단은 미정 |

## 단계 사이의 의존

- 단계 1의 결정(게이트 표준 여부)이 단계 3의 마무리 방식과 단계 4의 연동 조건에 영향을 준다. 그래서 새 서비스를 더 붙이기 전에 정한다.
- 단계 3의 운영 배포 전에 운영 Keycloak에 `member` 역할(#73)과 `litpage` 클라이언트가 있어야 한다.
- 단계 5는 단계 2의 드라이브 용량 측정이 있어야 한다.

## 후속 아이디어

- 한글(HWP/HWPX) 파일 편집기: [kordoc](https://github.com/chrisryugj/kordoc)을 참고해, Litpage 연동 뒤에 진행한다. 드라이브의 파일 형식 기반 이어쓰기와 함께 다룬다.
- 허용 라이선스 목록과 하단 서비스 가이드라인을 정해 단계 4에서 문서로 고정한다.
