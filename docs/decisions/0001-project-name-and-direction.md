# ADR 0001 - Project Name And Direction

날짜: 2026-07-18

## 결정

새 개인 서비스 플랫폼 프로젝트 이름은 `NaruWorks`로 한다.

repository 이름은 `naruworks-platform`을 사용한다.

## 배경

기존 `2030-korea-stablepay-network`는 Go 기반 결제/원장/정산 프로젝트다.

앞으로는 이보다 더 큰 개인 플랫폼을 만들고, 그 안에 StablePay를 결제 모듈로 연결하려고 한다.

이 플랫폼은 다음을 포함한다.

```text
전용 사이트
지인용 웹/앱 서비스
관리자 대시보드
인증/권한
홈서버 배포
CI/CD
결제/원장/정산 연동
```

## 이유

`NaruWorks`는 특정 결제 도메인에 묶이지 않고 여러 서비스를 담을 수 있다.

`Naru`는 사람들이 오가고 연결되는 길목의 느낌을 준다.

`Works`는 직접 만들고 운영하는 작업물과 서비스를 담는다.

## 결과

StablePay는 독립 결제/원장 기준 구현으로 유지한다.

NaruWorks는 플랫폼 core, 운영, 서비스 허브를 담당한다.

나중에 Spring Boot 재구현 또는 StablePay adapter를 통해 두 프로젝트를 연결한다.
