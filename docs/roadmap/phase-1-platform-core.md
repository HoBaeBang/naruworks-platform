# Phase 1 - Platform Core

목표는 NaruWorks의 첫 화면과 관리 가능한 기본 서비스를 만드는 것이다.

## 완료 기준

```text
public site가 열린다.
관리자 로그인이 가능하다.
프로젝트와 서비스 catalog를 등록/조회할 수 있다.
서비스 요청을 받을 수 있다.
local docker compose로 frontend/backend/db를 실행할 수 있다.
```

## 기능 후보

| 기능 | 설명 |
| --- | --- |
| Public Home | NaruWorks 소개와 프로젝트 목록 |
| Project Catalog | 포트폴리오 프로젝트 등록/조회 |
| Service Catalog | 운영 중이거나 만들 예정인 서비스 목록 |
| Service Request | 지인이 서비스 요청을 남기는 form |
| Admin Login | 관리자 접근 보호 |
| Admin Dashboard | 요청, 프로젝트, 서비스 상태 관리 |

## 구현 순서

```text
1. backend Spring Boot scaffold
2. frontend Next.js scaffold
3. PostgreSQL 연결
4. Project / Service catalog API
5. Public page
6. Admin page
7. Docker Compose local run
8. README 검증 절차 업데이트
```
