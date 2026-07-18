# Service Boundaries

NaruWorks는 모든 기능을 하나의 거대한 코드 덩어리로 만들지 않는다.

## 초기 경계

| 경계 | 책임 |
| --- | --- |
| platform-core | 사용자, 인증, 관리자, 서비스 catalog |
| portfolio | 프로젝트와 이력 공개 |
| service-request | 지인 또는 사용자의 서비스 요청 |
| payment | 결제 요청, 크레딧, 정산 연결 |
| operations | 배포, health, backup, logs |

## StablePay 경계

StablePay는 payment 경계 안으로 바로 복사하지 않는다.

초기 연결 방식:

```text
NaruWorks platform-api
-> stablepay-adapter
-> StablePay service
```

Spring 재구현 단계에서는 아래 두 방식 중 하나를 선택한다.

```text
1. NaruWorks 안에 payment module로 구현
2. 별도 stablepay-spring service로 구현하고 API 연동
```

초기 추천은 2번이다. 이유는 결제/원장 도메인이 플랫폼 core와 섞이지 않아야 하기 때문이다.
