# Naru Calendar API 계약

모든 Calendar API는 로그인한 서버 세션에서 현재 회원을 식별한다. 요청에 회원 ID를 전달하거나, 다른 회원의 데이터 존재 여부를 공개하지 않는다.

## 내부 일정과 날짜 메타데이터

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/calendar/events?from=&to=` | 조회 구간의 내부 일정과 선택 Google 읽기 전용 일정 병합 조회 |
| `POST` | `/api/calendar/events` | 선택한 편집 가능 캘린더에 일정 생성 |
| `GET` | `/api/calendar/events/{id}` | 내부 일정 상세 조회 |
| `PUT` | `/api/calendar/events/{id}` | 단일 일정 또는 반복 원본 전체 수정 |
| `DELETE` | `/api/calendar/events/{id}` | 내부 일정 원본·예외 삭제 |
| `PUT` | `/api/calendar/events/{id}/occurrence` | `THIS`, `THIS_AND_FOLLOWING`, `ALL` 범위 수정 |
| `DELETE` | `/api/calendar/events/{id}/occurrence` | 반복 회차 범위 삭제 |
| `GET` | `/api/calendar/day-metadata?from=&to=` | 음력·공휴일 읽기 전용 메타데이터 조회 |

일정 조회 응답은 내부 일정과 외부 일정을 구분하기 위해 `source`, `readOnly`를 포함한다. `source=GOOGLE`, `readOnly=true`인 항목은 수정·삭제 API의 대상이 아니다.

## 캘린더와 구성원

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/calendars` | 로그인 회원이 참여한 개인·공유 캘린더 목록 |
| `POST` | `/api/calendars` | 개인 또는 공유 캘린더 생성 |
| `PUT` | `/api/calendars/{calendarId}` | OWNER의 이름·표시 색상 변경 |
| `PUT` | `/api/calendars/{calendarId}/default` | 개인 기본 캘린더 지정 |
| `DELETE` | `/api/calendars/{calendarId}` | OWNER의 캘린더 삭제 |
| `GET` | `/api/calendars/{calendarId}/members` | OWNER의 참여 회원 목록 조회 |
| `DELETE` | `/api/calendars/{calendarId}/members/{memberId}` | OWNER의 참여 회원 제거 |
| `PUT` | `/api/calendars/{calendarId}/members/{memberId}/role` | OWNER의 EDITOR·VIEWER 역할 변경 |
| `PUT` | `/api/calendars/{calendarId}/ownership` | OWNER의 참여 회원 대상 소유권 이전 |
| `DELETE` | `/api/calendars/{calendarId}/membership` | EDITOR·VIEWER의 공유 캘린더 나가기 |

## 초대 링크

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/calendars/{calendarId}/invitation-links` | OWNER가 EDITOR 또는 VIEWER 링크 발급 |
| `GET` | `/api/calendars/invitation-links/preview?token=` | 수락 전 링크의 캘린더·소유자·권한 미리보기 |
| `POST` | `/api/calendars/invitation-links/accept` | 로그인 회원의 링크 수락 |
| `DELETE` | `/api/calendars/{calendarId}/invitation-links` | OWNER의 활성 초대 링크 폐기 |

## 오류와 보안

- 로그인하지 않은 요청은 `401`이다.
- 권한 없는 내부 일정·캘린더 접근은 존재 여부를 최소화하는 오류로 처리한다.
- `VIEWER`의 생성·수정·삭제 요청은 거절한다.
- 초대 링크 원문, OAuth refresh token, 암호화 키는 응답·로그·문서 예시에 포함하지 않는다.
- 실제 요청·응답 필드가 바뀌면 이 문서와 controller 테스트를 함께 갱신한다.
