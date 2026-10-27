# NaruWorks GitHub 작업 런북

## 이 문서의 역할

이 문서는 다른 Codex 세션이나 새 작업자가 NaruWorks의 GitHub 작업을 같은 방식으로 이어가기 위한 **실행 순서**다. 정책의 배경과 전체 기준은 [GitHub 협업 워크플로](github-workflow.md)를 함께 읽는다.

기본 원칙은 작고 독립적인 이슈 하나를 `feature/NARU-이슈번호-짧은-영문-설명` 브랜치에서 구현하고, PR로 `develop`에 병합하는 것이다. 실제 운영 배포는 별도 릴리즈 이슈와 `develop -> main` PR로 진행한다.

## 절대 지켜야 할 규칙

```text
main
= 배포 가능한 안정 브랜치

develop
= 기능 PR이 통합되는 브랜치

feature/NARU-이슈번호-짧은-영문-설명
= 이슈 하나를 해결하는 작업 브랜치
```

- `main`, `develop`에 직접 push하거나 직접 commit하지 않는다.
- 기능 브랜치는 반드시 최신 `develop`에서 만든다.
- 기능 PR은 `feature/* -> develop`으로 연다.
- 릴리즈 PR은 `develop -> main`으로 연다.
- `main`에서는 force push와 브랜치 삭제가 금지되어 있다. `develop`에도 직접 force push하지 않는다.
- feature 브랜치의 force push는 rebase나 커밋 정리가 꼭 필요할 때만 허용한다. 실행 뒤에는 PR에 이유를 남기고 CI를 다시 통과시킨다.
- 사용자가 만든 더티 변경은 절대 되돌리거나 섞지 않는다. 현재 작업과 관련 없으면 그대로 둔다.
- 커밋 메시지는 한글로 작성한다.

## 세션 시작 점검

작업 전에 저장소와 원격 브랜치 상태를 먼저 확인한다.

```bash
git status --short
git fetch origin
git branch -r --list 'origin/main' 'origin/develop'
gh auth status
```

`git status --short`에 변경이 있으면 그 변경의 소유자와 목적을 확인한다. 현재 작업과 분리할 수 있으면 새 worktree를 사용한다.

```bash
git worktree add ../naru-작업이름 develop
cd ../naru-작업이름
git switch -c feature/NARU-이슈번호-짧은-영문-설명
```

`origin/develop`이 보이지 않는 것은 정상 상태가 아니다. 자동으로 임의 생성하지 말고, `main`의 최신 릴리즈 상태와 이전 PR을 확인한 뒤 사용자에게 알린다. `develop`이 실수로 삭제됐다는 사실과 기준 commit이 확인된 경우에만 복구한다.

## 1. 이슈 만들기

구현을 시작하기 전에 이슈를 만든다. 이슈에는 왜 필요한지와 완료 기준을 먼저 기록한다. 작업량이 리뷰하기 어렵게 커지면 이슈를 나눈다.

```bash
gh issue create --repo HoBaeBang/naruworks-platform \
  --title '[Calendar] 일정 검색을 추가한다' \
  --label 'type:feature' \
  --label 'mode:implementation' \
  --label 'domain:calendar' \
  --assignee HoBaeBang \
  --body '...'
```

이슈 본문 기본 형식:

```md
## 배경
사용자에게 생긴 문제 또는 필요한 가치

## 목표
- 이번 이슈에서 실제로 제공할 결과

## 범위
- 수정할 화면, API, 데이터 또는 운영 설정

## 완료 기준
- 확인 가능한 동작 조건

## 검증 시나리오
1. 사용자가 직접 확인할 순서

## 작업 방식
`mode:learning` 또는 `mode:implementation`
```

- `mode:learning`: Codex가 구현 가이드와 검토 기준을 제공하고, 호배님이 구현한다.
- `mode:implementation`: 합의된 설계를 바탕으로 Codex가 구현과 PR 작성을 진행한다.

이슈와 PR에는 `type:*`, `mode:*`, `domain:*` 라벨을 모두 붙인다. 기본 assignee는 `HoBaeBang`이다. GitHub Project 보드를 함께 쓸 때는 이슈와 PR을 모두 보드에 추가한다.

## 2. 기능 브랜치 만들기

이슈 번호가 예를 들어 `42`라면 다음 순서로 시작한다.

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/NARU-42-calendar-search
```

다른 작업의 변경이 현재 워크트리에 있으면 위 명령으로 그 변경을 옮기거나 덮지 않는다. worktree를 새로 만들거나 기존 작업이 끝날 때까지 분리한다.

## 3. 구현과 검증

변경 범위에 맞는 테스트를 실행한다. 공통 최소 기준은 아래와 같다.

```bash
cd backend && ./gradlew clean test
cd frontend && npm ci && npm run lint && npm run build
```

변경하지 않은 영역의 실패는 숨기지 않는다. 실패 로그, 재현 조건, 이번 이슈와의 관련성을 PR에 남긴다. 환경 변수나 migration이 바뀌면 `.env.example`, Compose 문서, 배포 절차도 함께 점검한다.

커밋 전에 확인한다.

```bash
git diff --check
git status --short
git diff --stat
```

커밋과 push:

```bash
git add -- 경로/목록
git commit -m '일정 검색을 추가한다'
git push -u origin feature/NARU-42-calendar-search
```

## 4. 기능 PR 만들기

기능 PR의 base는 항상 `develop`이다. PR 본문은 리뷰어가 변경 이유와 테스트 방법을 코드 밖에서도 파악할 수 있게 작성한다.

```bash
gh pr create --repo HoBaeBang/naruworks-platform \
  --base develop \
  --head feature/NARU-42-calendar-search \
  --title '[Calendar] 일정 검색을 추가한다' \
  --label 'type:feature' \
  --label 'mode:implementation' \
  --label 'domain:calendar' \
  --assignee HoBaeBang \
  --body-file /tmp/naru-42-pr.md
```

`/tmp/naru-42-pr.md`의 기본 형식:

```md
## 변경 이유
문제와 이번 변경이 필요한 이유

## 주요 변경 파일
- `경로`: 변경 내용과 영향

## API / DB / 운영 영향
- 없으면 `없음`
- 있으면 migration, 환경 변수, 롤백 방법을 명시

## 검증 결과
- 실행한 명령과 결과

## 직접 테스트 방법
1. 화면 또는 API 확인 순서

## 리뷰 포인트
- 특히 확인해 줄 설계 판단 또는 회귀 위험

Closes #42
```

기능 PR이 실제로 `develop`에 merge되면 `Closes #42`가 이슈를 자동 종료한다. 릴리즈 PR에는 배포 성공 전까지 이 문구를 쓰지 않는다.

## 5. CI와 리뷰 반영

PR을 연 직후 CI와 본문을 확인한다.

```bash
gh pr view 번호 --repo HoBaeBang/naruworks-platform \
  --json title,body,baseRefName,headRefName,labels,statusCheckRollup,mergeStateStatus
gh pr checks 번호 --repo HoBaeBang/naruworks-platform --watch
gh pr view 번호 --repo HoBaeBang/naruworks-platform --comments
```

코드 줄 댓글은 PR의 `Files changed` 화면이나 API에서 추가로 확인한다. 피드백을 받으면 다음 순서를 지킨다.

1. 댓글의 의도와 영향 범위를 확인한다.
2. 필요한 코드·문서·테스트를 수정한다.
3. 관련 검증을 다시 실행한다.
4. 새 커밋을 push하고 PR 댓글로 무엇을 반영했는지 알린다.
5. CI가 다시 통과한 뒤 호배님의 최종 검토를 기다린다.

현재 같은 GitHub 계정을 함께 사용하므로 GitHub의 다른 계정 승인 수를 강제하지 않는다. 호배님이 PR의 `Files changed`, CI, 직접 테스트를 확인하고 직접 merge하는 것을 최종 승인으로 삼는다. Codex는 사용자의 명시 요청 없이는 PR을 merge하지 않는다.

## 6. 기능 PR merge 후 확인

호배님이 merge한 뒤 다음을 확인한다.

```bash
gh pr view 번호 --repo HoBaeBang/naruworks-platform --json state,mergedAt,mergeCommit
gh issue view 이슈번호 --repo HoBaeBang/naruworks-platform --json state
git fetch origin
git log --oneline -5 origin/develop
```

기능 이슈가 `CLOSED`인지, `develop`에 merge commit이 있는지 확인한다. GitHub 설정에서 자동 브랜치 삭제가 활성화되어 있으면 remote feature branch도 사라진다. 로컬 worktree와 브랜치는 다른 작업에 필요 없을 때만 정리한다.

## 7. 릴리즈 PR: develop에서 main으로

배포는 기능 PR과 별도로 다룬다.

1. `type:release`, 해당 `mode:*`, 관련 `domain:*` 라벨을 가진 릴리즈 이슈를 만든다.
2. `develop`의 포함 기능, DB migration, 환경 변수, 배포 순서와 롤백 방법을 이슈에 적는다.
3. `develop -> main` PR을 생성한다.
4. CI와 Compose 확인, 실제 운영 도메인의 핵심 흐름 테스트를 한다.
5. 호배님이 PR을 merge한다.
6. 홈서버 배포와 smoke test가 끝난 뒤 릴리즈 이슈를 수동으로 닫는다.

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
gh pr create --repo HoBaeBang/naruworks-platform \
  --base main \
  --head develop \
  --title '[릴리즈] 2026-10-02 Drive 개발 기반을 배포한다' \
  --label 'type:release' \
  --label 'mode:implementation' \
  --label 'domain:infra' \
  --assignee HoBaeBang
```

릴리즈 PR 본문에는 아래를 빠뜨리지 않는다.

```md
## 포함 변경
- 포함된 기능 이슈와 PR

## DB / 환경 변수 / 인프라 변경
- migration, `.env`, Compose, OAuth 등

## 배포 순서
1. 백업 또는 사전 점검
2. 배포 명령
3. smoke test

## 롤백 방법
- 이전 이미지 또는 commit으로 되돌리는 방법

## 검증 결과
- CI, 로컬 Compose, 운영 확인 결과
```

## 자주 만나는 예외

| 상황 | 대응 |
| --- | --- |
| PR base가 `main`으로 잘못 잡힘 | 아직 merge 전이면 `gh pr edit 번호 --base develop`으로 고친다. 릴리즈 PR만 `main`이 base다. |
| `develop`이 main보다 오래됨 | 릴리즈 PR에서 GitHub의 `Update branch` 또는 로컬 merge/rebase로 `main` 변경을 반영하고 CI를 다시 통과시킨다. |
| feature PR 순서가 꼬임 | 최신 `develop`을 feature에 rebase한 뒤 필요한 경우에만 `git push --force-with-lease`한다. 일반 `--force`는 사용하지 않는다. |
| CI가 cancelled | workflow 취소 원인을 확인하고 GitHub에서 re-run한다. 코드 실패로 단정하거나 임의로 CI 설정을 바꾸지 않는다. |
| PR 본문에 `\\n`이 그대로 보임 | 셸 인용이 잘못된 것이다. `--body-file`을 사용해 Markdown 파일로 본문을 다시 설정한다. |
| GitHub Project 조작 실패 | `gh auth refresh -s project`로 `project` scope를 추가한 뒤 다시 시도한다. |
| PR에 conflict가 생김 | base 최신 상태를 먼저 확인한다. feature PR이면 최신 `develop`, 릴리즈 PR이면 최신 `main`을 반영하고 충돌을 검토해 해결한다. |

## 새 세션 시작용 문구

새 Codex 세션에는 아래 문구와 작업 이슈 번호를 전달하면 된다.

```text
NaruWorks 저장소에서 이슈 #번호를 진행해 주세요.
GitHub 작업은 docs/development/git-github-session-runbook.md를 기준으로 합니다.
현재 워크트리의 기존 변경은 되돌리지 말고, 필요하면 별도 worktree를 사용하세요.
이슈 라벨과 assignee를 확인하고 feature/NARU-번호-짧은-영문-설명 브랜치에서 작업한 뒤 develop 대상 PR을 작성하세요.
PR에는 변경 이유, 주요 변경 파일, API/DB/운영 영향, 검증 결과, 직접 테스트 방법, 리뷰 포인트를 포함하세요.
```
