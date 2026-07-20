# Phase 1 - Platform Core

목표는 Naru 브랜드 홈과 서비스 카탈로그, 로컬 실행 기반을 만드는 것이다.

## 완료 기준

```text
public site가 열린다.
Naru 브랜드 홈에서 제공 서비스와 프로젝트를 확인할 수 있다.
프로젝트와 서비스 catalog를 조회할 수 있다.
local docker compose로 frontend/backend/db를 실행할 수 있다.
```

## 기능 후보

| 기능 | 설명 |
| --- | --- |
| Public Home | NaruWorks 소개와 프로젝트 목록 |
| Project Catalog | 포트폴리오 프로젝트 등록/조회 |
| Service Catalog | Naru에서 제공하거나 만들 예정인 서비스 목록 |
| Brand Home Design | Naru 브랜드 첫 화면의 정보 구조와 디자인 |
| Local Runtime | frontend, backend, PostgreSQL 로컬 실행 기반 |

## 구현 순서

```text
1. backend Spring Boot scaffold
2. frontend Next.js scaffold
3. PostgreSQL 연결
4. Project / Service catalog API
5. Public page
6. Docker Compose local run
7. README 검증 절차 업데이트
8. Naru Calendar 1단계 요구사항 정리
```
