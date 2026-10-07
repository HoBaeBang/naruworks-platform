# Naru Calendar 설계 문서

Naru Calendar는 NaruWorks 회원의 개인·공유 일정을 관리하고, 선택한 Google Calendar 일정을 읽기 전용으로 함께 보여주는 서비스다.

이 디렉터리는 Calendar의 최신 기획·도메인·API·운영·UX 기준이다. 기존 `docs/roadmap`, `docs/specs`, `docs/change-explanations` 문서는 구현 배경과 변경 이력으로 보존한다.

| 문서 | 역할 |
| --- | --- |
| [ERD](erd.md) | 현재 Flyway migration 기준의 테이블·컬럼·FK·제약·index |
| [도메인 모델](domain-model.md) | 내부·공유·Google 외부 일정의 데이터 경계와 권한 |
| [반복 일정·날짜 메타데이터](recurrence-and-day-metadata.md) | 반복 회차, 음력, 공휴일, 기간 일정의 계산 기준 |
| [API 계약](api-contract.md) | 현재 backend endpoint와 권한·응답 범위 |
| [Google Calendar 연동](google-calendar-integration.md) | OAuth, 다중 계정, 동기화, 연결 해제 정책 |
| [화면·UX 정책](ux-policy.md) | 연·월·주·일 보기, 모바일 정보 밀도, 스와이프 기준 |
| [구현 현황과 로드맵](implementation-roadmap.md) | 완료 기능, 보류 범위, 후속 우선순위 |

## 현재 제공 범위

```text
내부 일정
= 개인 캘린더 여러 개, 공유 캘린더, 기간·종일·반복 일정, 반복 회차 예외

날짜 보조 정보
= 대한민국 공휴일, 음력 날짜, 운영자 공휴일 예외

Google Calendar
= 여러 Google 계정 연결, 계정별 하위 캘린더 선택, 읽기 전용 저장본 동기화

보기
= 연간·월간·주간·일간, 모바일 월간·주간 대응, 좌우 스와이프 기간 이동
```

## 문서 경계

- Calendar 자체의 정책과 API는 이 디렉터리에 둔다.
- 로그인·회원·세션의 공통 정책은 `docs/architecture`와 프로젝트 운영 메모리에 둔다.
- 이 서비스의 현재 테이블 구조는 [Calendar ERD](erd.md)를 기준으로 한다. 기존 [공통 관계 ERD](../../specs/erd-relations.md)는 서비스 분리 전의 참고·이력 문서다.
- 특정 변경의 학습용 설명은 `docs/change-explanations/`에 보존한다.
