# Phase 3 - StablePay Integration

목표는 NaruWorks 안에서 StablePay의 결제/원장/정산 기능을 실제 서비스 흐름에 연결하는 것이다.

## 연결 대상

기준 구현:

```text
/Users/banghobae/Documents/2030-korea-stablepay/2030-korea-stablepay-network
```

StablePay가 제공하는 도메인:

```text
Payment
Ledger
Settlement
Deposit
Withdrawal
Wallet / Key Boundary
```

## NaruWorks에서 쓸 기능

| 기능 | 설명 |
| --- | --- |
| 결제 요청 | 서비스별 결제 요청 생성 |
| 크레딧/포인트 | 내부 사용량 또는 유료 기능에 사용 |
| 원장 기록 | 돈의 이동을 debit/credit으로 기록 |
| 정산 | 서비스 제공자 또는 관리자에게 지급 가능한 금액 계산 |
| 관리자 화면 | 결제 상태, 정산 상태, 실패/중복 이벤트 확인 |

## 구현 순서 후보

```text
1. stablepay-adapter interface 정의
2. 결제 요청 command 모델 작성
3. mock payment provider 연결
4. StablePay Go API 또는 Spring payment service 연결
5. admin settlement dashboard 작성
6. 실패/중복 처리 검증
```

## Spring 재구현 관계

Spring Boot 재구현은 Go 코드를 그대로 번역하는 것이 아니다.

```text
Go StablePay
= 도메인 규칙 검증용 기준 구현

Spring StablePay / NaruWorks payment module
= 한국 백엔드 채용 시장에 맞춘 Spring 생태계 재표현
```
