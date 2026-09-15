# GitHub 협업 워크플로

## 목적

NaruWorks의 모든 변경을 작은 이슈와 Pull Request 단위로 추적한다. 구현 의도, 리뷰, 자동 검증, 배포 단서를 GitHub에 남겨 기능이 늘어난 뒤에도 변경의 맥락을 확인할 수 있게 한다.

## 브랜치 전략

```text
main
  = 검증을 마치고 홈서버에 릴리즈할 수 있는 안정 브랜치

develop
  = 기능 이슈 PR이 모이는 통합 브랜치

feature/NARU-이슈번호-짧은-영문-설명
  = 하나의 기능 이슈를 구현하는 작업 브랜치
  = 예: feature/NARU-42-calendar-search
```

기능 작업은 항상 `develop`에서 분기하고 `develop`으로 PR을 연다. 릴리즈는 별도의 릴리즈 이슈를 만든 후 `develop`에서 `main`으로 PR을 연다. `main`과 `develop`에 직접 push하지 않는다.

## 라벨과 담당자

모든 이슈와 PR에는 작업 방식과 기능 영역 라벨을 붙인다. 라벨은 검색·릴리즈 범위 확인·리뷰 준비를 위한 분류 정보이며, 하나의 작업이 여러 영역에 걸치더라도 주된 영역 하나를 우선 선택한다.

| 분류 | 라벨 | 의미 |
| --- | --- | --- |
| 작업 유형 | `type:feature`, `type:release` | 기능 작업 또는 develop -> main 릴리즈 |
| 작업 방식 | `mode:learning`, `mode:implementation` | 호배님 구현 후 리뷰 또는 Codex 구현 후 리뷰 |
| 기능 영역 | `domain:platform` | 홈, 공통 UI, 회원 메뉴, 프로젝트 운영 |
| 기능 영역 | `domain:calendar` | Naru Calendar, Google Calendar, 공유 캘린더 |
| 기능 영역 | `domain:auth` | Google 로그인, 회원, 권한, 초대 |
| 기능 영역 | `domain:drive` | Naru Drive |
| 기능 영역 | `domain:docs` | Naru Docs, Sheets, Slides |
| 기능 영역 | `domain:infra` | Docker, Cloudflare, 홈서버, 배포 |

이슈와 PR의 기본 assignee는 `HoBaeBang`으로 둔다. 리뷰어는 현재 같은 GitHub 계정만 사용하므로 설정하지 않고, 호배님이 최종 검토와 merge를 담당한다.

## 작업 방식

각 기능 이슈를 만들 때 작업 방식을 하나 선택한다.

| 방식 | 역할 분담 | PR에서 중점적으로 보는 것 |
| --- | --- | --- |
| 학습형 | Codex가 설계·파일별 구현 가이드를 제공하고 호배님이 구현 | 구현 이해도, 테스트 의도, 개선점 |
| 구현형 | 설계 합의 후 Codex가 구현과 PR 작성을 담당 | 변경 이유, 설계 적합성, 회귀 위험, 직접 테스트 |

두 방식 모두 이슈의 완료 조건과 검증 시나리오를 먼저 합의한다. 작업량이 커 보이면 이슈를 더 작은 사용자 가치 단위로 나눈다.

## 기능 이슈 흐름

1. 기능 이슈를 만들고 배경, 완료 조건, 검증 시나리오, 작업 방식, 기능 영역을 채운다. 기본 assignee는 호배님이다.
2. `develop` 최신 상태에서 `feature/NARU-이슈번호-설명` 브랜치를 만든다.
3. 테스트를 먼저 작성할 수 있는 규칙은 Red -> Green -> Refactor로 진행한다.
4. 커밋 메시지는 한글로 작성한다.
5. PR의 대상 브랜치는 `develop`으로 정하고 `Closes #이슈번호`, `mode:*`, `domain:*` 라벨을 작성한다.
6. GitHub Actions의 `Backend Test`, `Frontend Quality`가 모두 성공해야 한다.
7. 호배님이 코드와 직접 테스트 결과를 검토하고 코멘트를 남긴다.
8. 코멘트 반영과 CI 재통과 후, 호배님이 PR을 머지한다.

## 릴리즈 흐름

1. `develop`에 모인 변경 중 배포할 범위를 릴리즈 이슈로 정의한다.
2. `develop -> main` PR을 열고 포함 이슈, DB migration, 환경 변수, 배포·롤백 계획을 작성한다.
3. CI와 Docker Compose 확인, 운영 도메인 핵심 흐름 테스트를 완료한다.
4. 호배님이 확인한 뒤 `main`으로 머지하고 홈서버에 배포한다.

자동 배포는 별도 이슈로 다룬다. PR CI에는 운영 환경 변수, Cloudflare token, Google OAuth secret을 넣지 않는다.

## CI 기준

PR CI는 `develop`, `main` 대상 PR과 두 브랜치의 push에서 실행한다.

| Job | 명령 | 역할 |
| --- | --- | --- |
| Backend Test | `cd backend && ./gradlew clean test` | Java 컴파일, 단위·Repository·통합 테스트 확인 |
| Frontend Quality | `cd frontend && npm ci && npm run lint && npm run build` | 의존성 재현, 정적 검사, production build 확인 |

CI workflow의 GitHub token 권한은 `contents: read`로 제한한다. CI는 소스 검증만 수행하며 배포나 외부 서비스 변경 권한을 갖지 않는다.

## GitHub Ruleset

`main`에는 다음 규칙을 적용한다.

- Pull Request 필수
- `Backend Test`, `Frontend Quality` 성공 필수
- force push 금지
- 브랜치 삭제 금지
- 새 커밋이 생긴 뒤 이전 review를 다시 승인으로 간주하지 않음
- PR 대화 해결 후 merge

현재 저장소는 같은 GitHub 계정으로 운영하므로, 다른 계정의 승인 수를 강제하지 않는다. 대신 호배님이 PR의 Files changed, CI, 직접 테스트를 확인한 뒤 직접 merge하는 것을 승인 절차로 삼는다.

`develop`에는 우선 CI 통과와 PR 경로를 운영 규칙으로 적용하고, 흐름이 안정되면 `main`과 같은 보호 규칙을 추가한다.
