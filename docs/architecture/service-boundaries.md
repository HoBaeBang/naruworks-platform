# Service Boundaries

NaruWorks는 모든 기능을 하나의 거대한 코드 덩어리로 만들지 않는다. 직접 만드는 서비스와 연동하는 오픈소스 서비스의 책임을 나눈다.

## 경계

| 경계 | 책임 |
| --- | --- |
| platform-core | 회원, 인증 연동, 관리자, 서비스 카탈로그 |
| naru-calendar | 일정, 반복·기간·날짜 메타데이터, Google Calendar 연동 |
| naru-drive | 파일과 폴더, 업로드·다운로드, 용량과 요금제 |
| 오픈소스 서비스 | 각 오픈소스의 고유 기능. 회원·로그인·저장은 플랫폼에 맡긴다 |
| operations | 배포, health, backup, logs |

## 플랫폼과 오픈소스 서비스의 약속

플랫폼이 제공하는 것:

- 회원 정보와 로그인(Keycloak OIDC), 회원 상태(`member` 역할)
- 나루 드라이브(결과물 저장)
- 서비스 카탈로그

오픈소스 서비스가 지키는 것:

- 자체 가입·로그인을 두지 않고 NaruWorks 로그인만 쓴다.
- 상단 NaruWorks 바와 하단 가이드라인을 적용한다.
- 라이선스 고지를 유지하고 라이선스 문제가 없는 것만 연동한다.
- 결과물을 드라이브에 저장할 수 있게 한다.

연동 조건과 절차는 [오픈소스 서비스 연동 기준](open-source-integration.md)에 있다.

## 코드 위치

| 위치 | 내용 |
| --- | --- |
| `backend/`, `frontend/` | NaruWorks 본체(Spring Boot, Next.js) |
| `services/<서비스 이름>/` | 가져와 수정한 오픈소스 서비스. 원본 출처와 수정 목록을 `NARU.md`에 적는다 |
| `infra/` | Compose, Keycloak realm, 운영 스크립트 |

## 초기 기획에 있던 StablePay 경계

초기에는 결제, 원장, 정산을 StablePay라는 별도 모듈로 두고 어댑터로 연결하는 구상이었다. 새 방향 문서에서는 이를 다루지 않으며, 요금제의 결제 방식을 정할 때 함께 결정한다.
