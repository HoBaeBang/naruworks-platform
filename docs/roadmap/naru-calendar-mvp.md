# Naru Calendar MVP

Naru Calendar는 Google Calendar처럼 일정을 만들고, 확인하고, 관리할 수 있는 개인 일정관리 서비스다.

최종 방향은 Google Calendar에 가까운 사용성을 목표로 하되, 1단계에서는 홈서버에서 직접 운영 가능한 최소 일정관리 기능부터 만든다.

Naru Calendar의 장기 목표에는 연간/월간/주간/일간 보기 전환, 대한민국 공휴일 표시, 음력 날짜 표시, 반복 일정, 장소 정보 입력을 포함한다.
다만 반복 일정과 공휴일/음력 데이터는 구현 난도가 높기 때문에 1단계 핵심 CRUD와 화면이 안정화된 뒤 단계적으로 붙인다.

## 목표

1단계 목표는 아래와 같다.

```text
내 DB에 일정을 저장한다.
월간 캘린더 화면에서 일정을 확인한다.
일정을 생성, 수정, 삭제할 수 있다.
이후 Google Calendar 동기화를 붙일 수 있도록 데이터 구조를 무리 없이 확장한다.
```

## 사용자 경험 방향

Naru Calendar는 Naru Home의 첫 번째 서비스다.

사용자는 Naru Home에서 Calendar 카드로 들어와 아래 작업을 할 수 있어야 한다.

```text
이번 달 일정을 한눈에 본다.
연간/월간/주간/일간 보기로 화면을 전환한다.
특정 날짜를 눌러 일정을 만든다.
기존 일정을 눌러 상세 내용을 확인한다.
일정을 수정하거나 삭제한다.
반복 일정을 만들 수 있다.
대한민국 공휴일을 확인한다.
양력 날짜 옆에서 음력 날짜를 작고 흐리게 확인한다.
오늘 날짜로 빠르게 돌아온다.
이전/다음 달로 이동한다.
```

첫 화면은 월간 캘린더를 기본으로 한다.
보기 전환 기능은 최종 목표에 포함하되, 1단계에서는 월간 보기부터 구현한다.

## 1단계 포함 기능

1단계에서 구현할 기능은 아래로 제한한다.

```text
월간 캘린더 화면
일정 목록 조회
일정 단건 조회
일정 생성
일정 수정
일정 삭제
하루 종일 일정 여부
일정 색상 지정
일정 장소 입력
오늘로 이동
이전/다음 달 이동
```

1단계에서 데이터 모델은 반복 일정, 공휴일, 음력 표시를 나중에 붙일 수 있도록 확장 가능하게 설계한다.

## 1단계 제외 기능

아래 기능은 Google Calendar에 있지만 1단계에서는 제외한다.

```text
Google Calendar 동기화
반복 일정
연간 캘린더
주간 캘린더
일간 캘린더
일정 초대
참석자 관리
알림
공유 캘린더
여러 캘린더 구분
시간대 변경
첨부파일
검색
대한민국 공휴일 자동 표시
음력 날짜 표시
권한/사용자 분리
드래그 앤 드롭 일정 이동
```

위 기능들은 Calendar 기본 CRUD와 월간 화면이 안정화된 뒤 단계적으로 추가한다.

## 화면 구성

Calendar 화면은 아래 1개 페이지를 중심으로 만든다.

```text
/calendar
```

1단계 페이지 구성:

```text
상단 바
- Naru Calendar 이름
- 오늘 버튼
- 이전 달 버튼
- 다음 달 버튼
- 현재 표시 중인 년/월
- 새 일정 버튼

월간 캘린더
- 요일 헤더
- 날짜 셀
- 오늘 날짜 강조
- 선택한 날짜 강조
- 날짜별 일정 목록 일부 표시

일정 생성/수정 모달
- 제목
- 설명
- 시작 일시
- 종료 일시
- 하루 종일 여부
- 장소
- 색상
- 저장 버튼
- 삭제 버튼
```

모바일에서는 월간 그리드를 유지하되, 날짜 셀 안의 일정 표시를 최소화한다.

최종 목표 페이지 구성:

```text
상단 바
- 보기 전환 탭: 연간 / 월간 / 주간 / 일간

캘린더 날짜 셀
- 대한민국 공휴일 표시
- 양력 날짜 옆 음력 날짜 작게 표시

일정 생성/수정 모달
- 반복 여부
- 반복 주기: 매주 / 매월 / 매년
- 반복 종료 조건
```

1단계 UI에서는 보기 전환 탭을 비활성 상태로 미리 배치할 수 있지만, 실제 동작은 월간 보기만 제공한다.
공휴일, 음력, 반복 일정, 연간/주간/일간 보기는 Calendar CRUD가 안정화된 뒤 구현한다.

## Event 데이터 모델 초안

일정은 `CalendarEvent`로 부른다.

```text
id
= 내부 식별자

title
= 일정 제목

description
= 일정 설명

startAt
= 일정 시작 일시

endAt
= 일정 종료 일시

allDay
= 하루 종일 일정 여부

location
= 일정 장소

color
= 화면에 표시할 일정 색상

recurrenceRule
= 반복 일정 규칙

recurrenceEndAt
= 반복 일정 종료 일시

status
= 일정 상태

createdAt
= 생성 시각

updatedAt
= 수정 시각
```

초기 status:

```text
ACTIVE
= 일반 일정

CANCELLED
= 취소된 일정
```

1단계 삭제는 물리 삭제로 시작한다.
취소 상태는 나중에 일정 취소/복원 기능이 필요할 때 사용한다.

반복 일정은 아래 규칙을 목표로 한다.

```text
NONE
= 반복 없음

WEEKLY
= 매주 같은 요일 반복

MONTHLY
= 매월 같은 날짜 반복

YEARLY
= 매년 같은 날짜 반복
```

반복 일정은 1단계 구현 대상에서는 제외하지만, DB와 API 초안에는 확장 후보로 기록한다.

## 공휴일과 음력 표시 방향

대한민국 공휴일과 음력 날짜는 사용자가 직접 만든 일정과 다른 성격의 보조 캘린더 데이터다.

구현 방향은 아래처럼 나눈다.

```text
대한민국 공휴일
= 날짜 셀에 공휴일 이름을 표시한다.
= 예: 설날, 추석, 어린이날, 광복절
= 대체공휴일을 고려해야 한다.

음력 날짜
= 양력 날짜 옆에 작고 흐리게 표시한다.
= 예: 7월 23일 옆에 음력 날짜를 보조 텍스트로 표시
```

초기에는 직접 계산보다 별도 데이터 소스 또는 라이브러리 사용을 검토한다.
공휴일/음력 데이터는 매년 정확성이 중요하므로, 실제 구현 시점에 현재 사용 가능한 라이브러리나 공공 API를 확인한다.

## API 초안

초기 API는 단순 CRUD를 기준으로 한다.

```text
GET /api/calendar/events
= 일정 목록 조회

GET /api/calendar/events/{id}
= 일정 단건 조회

POST /api/calendar/events
= 일정 생성

PUT /api/calendar/events/{id}
= 일정 수정

DELETE /api/calendar/events/{id}
= 일정 삭제
```

목록 조회는 월간 화면을 위해 기간 조건을 받는다.

```text
GET /api/calendar/events?from=2026-07-01T00:00:00&to=2026-08-01T00:00:00
```

## Request / Response 초안

일정 생성 요청:

```json
{
  "title": "운동",
  "description": "저녁 러닝",
  "startAt": "2026-07-23T19:00:00",
  "endAt": "2026-07-23T20:00:00",
  "allDay": false,
  "location": "한강공원",
  "color": "#20b977",
  "recurrenceRule": "NONE",
  "recurrenceEndAt": null
}
```

일정 응답:

```json
{
  "id": 1,
  "title": "운동",
  "description": "저녁 러닝",
  "startAt": "2026-07-23T19:00:00",
  "endAt": "2026-07-23T20:00:00",
  "allDay": false,
  "location": "한강공원",
  "color": "#20b977",
  "recurrenceRule": "NONE",
  "recurrenceEndAt": null,
  "status": "ACTIVE"
}
```

## Backend 구현 구조

기존 멀티 모듈 구조를 그대로 따른다.

```text
naru-domain
- CalendarEvent
- CalendarEventStatus
- CalendarEventRecurrenceRule

naru-core
- CalendarService
- CalendarEventReader
- CalendarEventWriter

naru-infrastructure
- CalendarEventEntity
- CalendarEventJpaRepository
- CalendarEventPersistenceAdapter
- Flyway migration

naru-api
- CalendarEventController
- CalendarEventCreateRequest
- CalendarEventUpdateRequest
- CalendarEventResponse
```

## DB 테이블 초안

테이블명:

```text
calendar_events
```

컬럼:

```text
id BIGSERIAL PRIMARY KEY
title VARCHAR(100) NOT NULL
description TEXT
start_at TIMESTAMP NOT NULL
end_at TIMESTAMP NOT NULL
all_day BOOLEAN NOT NULL
location VARCHAR(255)
color VARCHAR(20) NOT NULL
recurrence_rule VARCHAR(30) NOT NULL
recurrence_end_at TIMESTAMP
status VARCHAR(30) NOT NULL
created_at TIMESTAMP NOT NULL
updated_at TIMESTAMP NOT NULL
```

DB 테이블/컬럼 의미는 Flyway migration의 `COMMENT ON TABLE/COLUMN`으로 함께 남긴다.

## Frontend 구현 구조

초기에는 `/calendar` 페이지 안에서 월간 화면을 만든다.

```text
frontend/src/app/calendar/page.tsx
frontend/src/components/calendar/calendar-month-view.tsx
frontend/src/components/calendar/calendar-view-switcher.tsx
frontend/src/components/calendar/calendar-event-modal.tsx
frontend/src/lib/calendar-api.ts
frontend/src/types/calendar.ts
```

월간 그리드와 기본 CRUD 흐름은 직접 구현한다.
연간/주간/일간 보기, 반복 일정, 드래그 앤 드롭이 필요해지는 시점에는 캘린더 라이브러리 도입을 검토한다.

## 구현 순서

1차 구현 순서는 아래를 따른다.

```text
1. CalendarEvent 도메인 모델 작성
2. calendar_events Flyway migration 작성
3. JPA Entity / Repository / Adapter 작성
4. CalendarService 작성
5. Calendar Event 목록 조회 API 작성
6. 생성 API 작성
7. 수정 API 작성
8. 삭제 API 작성
9. Repository 테스트 작성
10. API 통합 테스트 작성
11. Frontend calendar-api 작성
12. /calendar 월간 화면 작성
13. 일정 생성/수정 모달 작성
14. 로컬 실행 검증
```

## 단계별 구현 계획

Calendar는 아래 단계로 확장한다.

```text
Step 1
= 월간 보기
= 단일 일정 CRUD
= 장소, 색상, 하루 종일 여부
= 반복 규칙은 NONE만 저장

Step 2
= 반복 일정 생성
= 매주 / 매월 / 매년 반복
= 반복 종료일

Step 3
= 연간 / 주간 / 일간 보기
= 보기 전환 UI 실제 동작

Step 4
= 대한민국 공휴일 표시
= 음력 날짜 표시

Step 5
= Google Calendar OAuth 연동
= Google Calendar 일정 가져오기
= 양방향 동기화 검토
```

## 이후 확장 후보

1단계 이후에는 아래 순서로 확장한다.

```text
반복 일정
대한민국 공휴일 표시
음력 날짜 표시
알림
검색
연간/주간/일간 보기
드래그 앤 드롭 일정 이동
여러 캘린더 구분
Google Calendar OAuth 연동
Google Calendar 양방향 동기화
공유/초대
```
