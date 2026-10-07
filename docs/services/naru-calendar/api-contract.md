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

`from`, `to`, `occurrenceStartAt`은 ISO-8601 `LocalDateTime` 형식이다. 생성·수정 본문은 `calendarId`, `title`, `startAt`, `endAt`, `allDay`, `color`, `recurrenceRule`을 사용하며, `recurrenceRule`은 `NONE`, `WEEKLY`, `MONTHLY`, `YEARLY`, `LUNAR_YEARLY` 중 하나다. `recurrenceEndAt`은 선택 사항이다.

반복 회차 수정 본문은 위 일정 필드와 함께 `occurrenceStartAt`, `scope`를 포함한다. `scope`는 `THIS`, `THIS_AND_FOLLOWING`, `ALL` 중 하나이며, 회차 삭제도 같은 두 값을 query parameter로 받는다.

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

캘린더 생성 본문은 `name`, `shared`, `displayColor`이며, 수정 본문은 `name`, `displayColor`이다. 구성원 역할 변경은 `{ "role": "EDITOR" | "VIEWER" }`, 소유권 이전은 `{ "memberId": number }`를 사용한다.

## 초대 링크

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/calendars/{calendarId}/invitation-links` | OWNER가 EDITOR 또는 VIEWER 링크 발급 |
| `GET` | `/api/calendars/invitation-links/preview?token=` | 수락 전 링크의 캘린더·소유자·권한 미리보기 |
| `POST` | `/api/calendars/invitation-links/accept` | 로그인 회원의 링크 수락 |
| `DELETE` | `/api/calendars/{calendarId}/invitation-links` | OWNER의 활성 초대 링크 폐기 |

발급 요청은 `{ "role": "EDITOR" | "VIEWER" }`, 수락 요청은 `{ "token": "원문 초대 토큰" }`이다. 링크 원문은 발급 응답에서만 전달하며 서버 DB에는 저장하지 않는다.

## Google Calendar 연동

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/calendar/integrations/google/authorize` | OAuth state를 세션에 저장하고 Google 동의 화면으로 redirect |
| `GET` | `/api/calendar/integrations/google/callback?code=&state=` | state·로그인 회원을 검증하고 연결을 저장한 뒤 Calendar로 복귀 |
| `GET` | `/api/calendar/integrations/google` | 현재 회원이 연결한 Google 계정과 최근 동기화 상태 조회 |
| `GET` | `/api/calendar/integrations/google/accounts/{integrationId}/calendars` | 계정의 하위 Google Calendar와 현재 선택 상태 조회 |
| `PUT` | `/api/calendar/integrations/google/accounts/{integrationId}/calendars` | 표시·동기화할 하위 캘린더 선택 저장 |
| `POST` | `/api/calendar/integrations/google/accounts/{integrationId}/synchronize` | 선택된 하위 캘린더 즉시 동기화 |
| `DELETE` | `/api/calendar/integrations/google/accounts/{integrationId}` | 연결 해제와 저장 토큰·외부 일정 제거 |

하위 캘린더 선택 요청은 `{ "calendarIds": ["Google calendar id"] }`다. OAuth callback은 브라우저 redirect 전용이며, access token과 refresh token을 API 응답에 포함하지 않는다.

## 오류와 보안

- 로그인하지 않은 요청은 `401`이다.
- 권한 없는 내부 일정·캘린더 접근은 존재 여부를 최소화하는 오류로 처리한다.
- `VIEWER`의 생성·수정·삭제 요청은 거절한다.
- 초대 링크 원문, OAuth refresh token, 암호화 키는 응답·로그·문서 예시에 포함하지 않는다.
- 실제 요청·응답 필드가 바뀌면 이 문서와 controller 테스트를 함께 갱신한다.
