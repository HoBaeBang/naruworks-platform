# NaruWorks 테스트 작성 가이드

## 목적

테스트는 단순히 빌드를 통과시키기 위한 코드가 아니다. NaruWorks에서 테스트는 다음을 확인한다.

```text
1. 기능이 요구한 대로 동작하는가
2. 이후 변경이 기존 기능을 깨뜨리지 않는가
3. 다른 회원의 데이터가 노출되지 않는가
4. 코드를 수정할 때 무엇을 지켜야 하는지 알 수 있는가
```

특히 인증, 회원 소유 데이터, 결제처럼 접근 제어가 중요한 기능은 테스트가 서비스의 안전 경계가 된다.

## 기본 원칙

### Red - Green - Refactor

새로운 비즈니스 규칙은 가능한 한 아래 순서로 구현한다.

```text
1. 동작을 한 문장으로 정의한다.
2. 그 동작을 검증하는 테스트를 작성한다.
3. 테스트가 실패하는 것을 확인한다. (Red)
4. 테스트를 통과하는 최소 구현을 작성한다. (Green)
5. 중복과 표현을 정리한 뒤 전체 테스트를 다시 실행한다. (Refactor)
```

예시:

```text
회원 B는 회원 A의 일정을 조회할 수 없다.
```

이 문장이 먼저 테스트 이름이 되고, 구현은 그 테스트를 통과하도록 작성한다.

### 테스트는 구현 세부 사항이 아니라 결과를 검증한다

private 메서드, 내부 Builder 호출, 특정 Repository 호출 횟수 자체를 테스트의 주목적으로 삼지 않는다.
입력 후 어떤 결과가 나오는지, 어떤 데이터가 저장되는지, 어떤 상태 코드가 반환되는지를 검증한다.

```text
좋은 예: 회원 B가 회원 A의 일정 ID를 조회하면 404를 반환한다.
피할 예: CalendarEventPersistenceAdapter의 private 메서드가 호출된다.
```

### 테스트 이름은 한 가지 행동만 설명한다

`@DisplayName`은 한 테스트가 보장하는 행동을 한국어로 적는다.

```java
@DisplayName("회원 B는 회원 A의 일정을 조회할 수 없다")
```

한 테스트에 생성, 수정, 삭제, 권한 검증을 모두 넣지 않는다.

## 계층별 테스트 선택

| 대상 | 주로 사용할 테스트 | 검증 내용 |
| --- | --- | --- |
| Domain Model / Value Object | JUnit 단위 테스트 | 값 검증, 상태 전이, 도메인 규칙 |
| Service | JUnit + Mockito | 트랜잭션 흐름, 권한·소유자 규칙, Port 조합 |
| JPA Repository | `@DataJpaTest` | 조회 조건, 정렬, 저장, 제약 조건 |
| Controller HTTP 계약 | `@WebMvcTest` + MockMvc | HTTP 상태, 요청 검증, 응답 JSON, 예외 형식 |
| Security / Resolver / JPA 연결 | `@SpringBootTest` + MockMvc | 실제 인증, Argument Resolver, Service, JPA 연결 |
| Frontend | lint, build, 브라우저 수동 흐름 | 화면 상태, API 연결, 실제 사용자 경험 |

모든 것을 통합 테스트로 만들지 않는다. 빠른 단위 테스트와 slice 테스트를 기본으로 하고, 계층 사이의 실제 연결이 중요한 경우에만 `@SpringBootTest` 통합 테스트를 추가한다.

## NaruWorks에서의 작성 방식

### Repository: `@DataJpaTest`

Repository 쿼리 조건은 실제 JPA와 H2에서 검증한다.

```text
Given: 회원 A 일정 2개, 회원 B 일정 1개
When: 회원 A ID와 조회 기간으로 목록을 조회
Then: 회원 A의 기간 내 일정만 시작 시각 오름차순으로 반환
```

캘린더처럼 소유자 조건이 있는 Repository는 반드시 다른 회원 데이터를 함께 넣어 격리를 검증한다.

### Service: Mockito 단위 테스트

Service는 Port를 Mock으로 두고 비즈니스 규칙에 집중한다.

```text
Given: 로그인 회원 A
When: 일정 생성 요청
Then: Writer에 전달되는 CalendarEvent의 memberId는 A의 ID다.
```

Mockito는 외부 의존성을 대체하는 도구다. 테스트 대상은 Mock이 아니라 Service의 결과와 규칙이다.

### Controller: `@WebMvcTest`

새 API의 TDD 시작점은 `@WebMvcTest(대상Controller.class)`이다. Controller가 받는
Service나 Resolver 의존성은 Mockito로 대체하고, HTTP 계약을 먼저 Red -> Green으로 만든다.

```text
Given: 고정된 현재 회원을 반환하는 CurrentMemberArgumentResolver mock
When: GET /api/members/me
Then: 200과 약속한 JSON 필드를 반환
```

이 테스트는 DB와 전체 애플리케이션을 시작하지 않으므로 빠르다. 인증과 현재 회원 해석은
통합 테스트에서 검증하고, 여기서는 Controller가 전달받은 Member를 올바른 HTTP 응답으로
변환하는 데 집중한다.

### API 연결: `@SpringBootTest` + MockMvc

`@SpringBootTest`는 Controller, Spring Security, Argument Resolver, Service, JPA 연결을
함께 검증한다. 같은 HTTP 계약을 모든 경우에 중복하지 않고, 핵심 인증 경로와 소유권 경계에
소수로 둔다.

OAuth 실제 로그인은 호출하지 않고 `oauth2Login()`으로 테스트용 인증 정보를 만든다.

```text
oauth2Login().attributes(attributes -> attributes.put("sub", "google-member-a"))
```

이 `sub`는 H2의 `members.provider_user_id`와 일치해야 한다.

```text
OAuth2User sub
-> CurrentMemberArgumentResolver
-> members 조회
-> 승인 회원 확인
-> Controller의 @CurrentMember Member 전달
```

인증이 필요한 API의 통합 테스트에는 인증 정보를 붙인다. 인증 없이 차단되는 동작은 별도 테스트로 남긴다.

```text
인증된 회원 A의 생성 요청 -> 201
인증되지 않은 생성 요청 -> 403
회원 B의 회원 A 일정 조회 -> 404
```

## Given - When - Then

테스트 본문은 다음 순서를 기본으로 한다.

```java
@Test
@DisplayName("회원 B는 회원 A의 일정을 조회할 수 없다")
void memberBCannotFindMemberAEvent() throws Exception {
    // given
    CalendarEventEntity memberAEvent = saveMemberAEvent();

    // when & then
    mockMvc.perform(get("/api/calendar/events/{id}", memberAEvent.getId())
                    .with(memberBAuthentication()))
            .andExpect(status().isNotFound());
}
```

주석은 긴 설명이 아니라 테스트 단계가 읽히도록 돕는 용도로만 사용한다.

## 변경 작업의 테스트 순서

DB 컬럼이나 API 계약이 바뀌는 리팩터링은 테스트도 함께 바뀐다. 이때는 아래 순서를 권장한다.

```text
1. 기존 테스트가 무엇을 보장하는지 읽는다.
2. 새 규칙의 핵심 테스트를 먼저 추가한다.
3. Domain / Entity / Repository 계약을 함께 변경한다.
4. 컴파일 오류가 난 fixture를 새 데이터 구조로 맞춘다.
5. 단위 테스트 -> Repository 테스트 -> Controller slice 테스트 -> API 통합 테스트 순서로 실행한다.
6. 마지막에 실제 브라우저와 PostgreSQL로 사용자 흐름을 확인한다.
```

회원별 캘린더 전환처럼 횡단 변경이 큰 작업은 모든 파일이 잠깐 깨질 수 있다. 이 경우에도 "컴파일을 맞추는 것"에서 멈추지 않고, 회원 A/B 격리 테스트를 최종 기준으로 삼는다.

## 실행 명령

```bash
cd backend

# 특정 모듈의 빠른 확인
./gradlew :naru-core:test
./gradlew :naru-infrastructure:test
./gradlew :naru-api:test

# 전체 확인
./gradlew test
```

```bash
cd frontend
npm run lint
npm run build
```

## 실제 연동 테스트와의 관계

자동 테스트가 모두 통과해도 실제 브라우저와 PostgreSQL 연동 테스트는 필요하다.

```text
자동 테스트
= 코드 규칙과 회귀를 빠르게 확인

실제 연동 테스트
= Google OAuth 세션, CORS, Docker, Flyway, 브라우저 쿠키, 화면 흐름을 확인
```

둘 중 하나만으로는 충분하지 않다. 기능 단위가 끝날 때마다 자동 테스트를 통과시키고, 로그인·가입·권한처럼 사용자 흐름이 중요한 기능은 실제 브라우저에서도 확인한다.
