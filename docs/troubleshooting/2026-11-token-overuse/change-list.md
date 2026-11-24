# 개선 적용용 변경 목록

- 작성: 2026-11-25 자비스
- 근거: `troubleshooting.md` 6장
- 상태 (2026-11-25 호배님 승인 후): C1~C6 저장소 반영(#96), C13 브리지 v0.1.7 적용, C7~C10 문구 확정(`bot-rules.md`) · 각 봇 설정 반영 대기, C11·C12 제외(C11은 C10으로 대체).
- 공통 원칙
  - 변경 전에 원본을 백업합니다.
  - 브리지·파일 변경은 Mac에서 호배님 승인 후에만 합니다.
  - push·PR은 별도 승인을 받습니다.
- 설치: **없음.** 모든 항목이 새 패키지 설치 없이 가능합니다.
  - HTML→PNG 대안 검증은 이 목록에 넣지 않았습니다. 헤드리스 브라우저 설치가 필요해 따로 승인을 받습니다.

| 항목 | 대상 종류 | 설치 | 코드 수정 |
|---|---|---|---|
| C1~C3 | 신규 파일 (`docs/design/agent-inputs/`) | 없음 | 없음 |
| C4~C6 | 브리지 프롬프트 작성 규칙 (`docs/design/agent-inputs/prompt-rules.md`) | 없음 | 없음 |
| C7~C10 | 봇 작업 규칙 | 없음 | 없음 |
| C11~C13 | 브리지 코드 (`naru_orch.py` v0.1.7) | 없음 | **있음** |

---

## C1. 디자인 규칙 요약본 신규 파일

- **대상:** `docs/design/agent-inputs/design-rules-summary.md` (신규, naruworks-platform)
- **변경:** 지금 매번 원문으로 로드하는 디자인 스킬 5종의 규칙 중 이 프로젝트에 필요한 것만 2~3KB로 요약합니다.
  - 대상 스킬: design-taste-frontend, hallmark, ui-ux-pro-max, frontend-design, web-design-guidelines
  - 담을 내용: 타이포, 간격, 색 대비(WCAG 2.1 AA), 상태 표시, 금지 패턴
  - 지금 브리지 프롬프트에 인라인으로 들어가는 Web Interface Guidelines의 핵심 규칙도 여기로 옮깁니다.
- **작성 방식:** 자비스가 스킬 원문 4종과 2026-11-19 인라인 가이드라인을 읽고 요약해 초안을 만들었습니다(Claude 잡 미사용). 디자인 봇과 호배님이 PR에서 검토합니다.
- **설치/코드:** 없음 / 없음
- **되돌리기:** 파일을 삭제하고, C4에서 프롬프트를 원래대로 돌립니다.

## C2. FigCraft 명령 요약표 신규 파일

- **대상:** `docs/design/agent-inputs/figcraft-cheatsheet.md` (신규)
- **변경:** `list_commands` 결과를 한 번 정리해 자주 쓰는 명령과 파라미터만 표로 만듭니다.
  - 자주 쓰는 명령: node.create, node.set, edit.duplicate, instance.create, node.reparent, variable.create/bind, file.export
  - 지난 작업에서 오류가 났던 항목을 "주의"로 적습니다.
    - textAlignVertical 값
    - padding 계열은 auto layout 전용
    - batch의 `$ref` 규칙
    - export 형식은 소문자 `png`
    - `node.delete`는 없는 명령
- **설치/코드:** 없음 / 없음
- **되돌리기:** 파일 삭제

## C3. 화면별 문서 발췌 신규 파일

- **대상:** `docs/design/agent-inputs/excerpts/WF-NN.md` (신규, 화면당 1개, 생성기 `make_excerpts.py`)
- **변경:** screens.md와 screen-data-actions.md에서 해당 화면 절만 잘라 둡니다. 원본은 그대로 둡니다.
  - 원본을 고치면 발췌도 다시 만들어야 합니다. 디자인 봇 규칙(C7)에 이 절차를 넣습니다.
- **설치/코드:** 없음 / 없음
- **되돌리기:** `excerpts/` 폴더 삭제

## C4. 디자인 작성 잡 프롬프트 규칙 변경

- **대상:** 디자인 봇이 P3-4 작성 잡의 `prompt.md`를 만들 때 쓰는 규칙 → `docs/design/agent-inputs/prompt-rules.md`로 문서화
  - 별도 템플릿 파일은 확인되지 않았습니다. 기존 잡의 prompt.md를 바탕으로 매번 작성하는 것으로 보이며, 적용 전에 확인이 필요합니다.
- **변경 (지금 → 바꾼 후):**

  | 지금 | 바꾼 후 |
  |---|---|
  | "0단계 — 다섯 스킬을 실제로 로드" | "C1 요약본만 Read" |
  | "인라인: Web Interface Guidelines" 13.6~16.7KB | 삭제 (C1로 이동) |
  | screens.md·screen-data-actions.md 전체 | 해당 WF 발췌 파일(C3)만 |
  | list_commands로 명령 탐색 | C2 요약표 참조. list_commands는 요약표에 없는 명령이 필요할 때만 1회 |
  | 화면 4개 묶음 | 화면 1~2개 (C7과 연동) |

- **설치/코드:** 없음 / 없음
- **되돌리기:** 기존 잡 폴더의 prompt.md(예: `~/.naru-orch/jobs/P3-4-screens-wf13-16-01/prompt.md`)를 원본 기준으로 다시 씁니다.

## C5. 스크린샷 사용 규칙

- **대상:** C4와 같은 프롬프트 규칙의 "도구 제한" 절
- **변경:**
  - 렌더 확인 `figcraft screenshot`은 프레임마다 완성 뒤 1회, `maxSize` 1000 이하로 찍습니다.
  - 중간 확인은 `get_node`로 필요한 필드만 조회합니다.
  - 내보낸 PNG를 Read로 다시 열지 않습니다(검수는 Gemini 단계에서 합니다).
- **설치/코드:** 없음 / 없음
- **되돌리기:** 해당 문장 삭제

## C6. 검수 잡 프롬프트 규칙

- **대상:** Gemini 검수 잡(review-NN) `prompt.md` 작성 규칙
- **변경:**
  - 재검수 프롬프트에는 직전 지적 목록과 바뀐 화면 PNG만 넣습니다. 전체 화면은 다시 넣지 않습니다.
  - 출력은 "막는 문제 / 주요 / 경미" 표로 하고 2KB 이내로 제한합니다.
- **설치/코드:** 없음 / 없음
- **되돌리기:** 기존 review 프롬프트(예: `P3-4-screens-wf13-16-review-13/prompt.md`) 형식으로 되돌립니다.

## C7. 디자인 봇 작업 규칙: 작업 단위와 검수 상한

- **대상:** 디자인 봇의 작업 규칙(봇 지시문·메모리)
- **변경:**
  - 작성 잡 1개는 화면 1~2개만 다룹니다.
  - 같은 묶음의 검수는 최대 2회입니다. 2회째에도 막는 문제가 남으면 호배님께 결정을 요청합니다.
  - 경미한 지적은 모아서 한 번에 고칩니다.
  - 원본 문서가 바뀌면 C3 발췌를 다시 만듭니다.
- **설치/코드:** 없음 / 없음
- **되돌리기:** 적용 전 규칙 문구를 백업해 두고 그대로 복원합니다.

## C8. 모든 역할 봇 작업 규칙: 보조 작업자 운영

- **대상:** 기획·디자인·설계 봇 작업 규칙
- **변경:**
  - 보조 작업자(executor)는 작업 1~2건마다 새로 시작합니다.
  - 인계는 작업 폴더의 짧은 요약 파일(1KB 이하)로 합니다.
  - 봇 메인 대화에서는 `naru-orch status` 반복 확인, `sleep` 대기, 이미지(PNG) 열기를 하지 않습니다. 완료 알림만 받습니다.
- **설치/코드:** 없음 / 없음
- **되돌리기:** 규칙 문구 복원

## C9. 보고 형식 규칙

- **대상:** 자비스와 각 역할 봇의 작업 규칙
- **변경:**
  - 보조 작업자 → 봇 보고는 1KB 이하 요약 + 파일 경로로 합니다.
  - 봇 → 자비스 보고는 결정 필요 사항과 결과 경로 위주로 합니다.
  - 그룹방에는 이전 점검과 달라진 점만 올립니다.
- **설치/코드:** 없음 / 없음
- **되돌리기:** 규칙 문구 복원

## C10. Claude 작업 동시 실행 운영 규칙 (코드 적용 전 임시)

- **대상:** 자비스 조율 규칙
- **변경:** Claude 쓰기 잡은 봇들 사이에서 동시에 1개만 돌립니다. 자비스가 순서를 정합니다. C11을 적용하면 이 규칙은 해제합니다.
- **설치/코드:** 없음 / 없음
- **되돌리기:** 규칙 문구 삭제

## C11. 브리지: Claude 쓰기 잡 동시 실행 제한

- **대상:** `~/.naru-orch/bin/naru_orch.py` → v0.1.7, `config.json`에 키 추가
- **변경:**
  - `config.json`에 `"max_concurrent": {"claude:write": 1}`를 추가합니다.
  - 제출(submit) 때 실행 중인 같은 종류의 잡 수를 세서, 상한을 넘으면 `queued` 상태로 둡니다.
  - 기존 `status` / `_refresh` 흐름에서 빈자리가 나면 대기 중인 잡을 시작합니다.
  - state.db 스키마는 바꾸지 않습니다.
- **설치/코드:** 없음 / **있음**. 수정 코드 diff를 먼저 보고 승인받습니다.
- **되돌리기:** `naru_orch.py.bak-<시각>`으로 복원하고 config 키를 삭제합니다.

## C12. 브리지: 한도 감지 시 남은 잡 보류

- **대상:** `naru_orch.py` v0.1.7
- **변경:**
  - `provider_limits`에 Claude 냉각(cooldown)이 기록되면, 새로 제출된 Claude 쓰기 잡을 Codex로 폴백하지 않습니다. 대신 `until` 시각까지 `queued`로 둡니다.
  - 지금 동작은 Codex 폴백이고, 이번 기간에 폴백 3건이 취소·재실행으로 이어졌습니다.
  - 설정 `"on_limit": "hold" | "fallback"`으로 선택할 수 있게 하고, 기본값은 지금처럼 `fallback`으로 둡니다.
- **설치/코드:** 없음 / **있음**
- **되돌리기:** 백업 복원, 또는 `on_limit`을 `fallback`으로 둡니다.

## C13. 브리지: 잡별 토큰 사용량 기록

- **대상:** `naru_orch.py` v0.1.7, state.db
- **변경:**
  - state.db에 `job_usage` 테이블을 추가합니다. 열: job_id, provider, session, api_calls, input, output, cache_creation, cache_read, ctx_max.
  - 기존 테이블은 건드리지 않습니다.
  - 잡이 끝나면(done·failed·timeout, 한도 소진으로 넘기기 직전) 다음 값을 읽기 전용으로 집계해 저장합니다. 조회는 `naru-orch usage <job_id> [--refresh]`(`status` 출력은 바꾸지 않음).
    - Claude: 작업 폴더별 `~/.claude/projects/<폴더>/` jsonl 중 잡 시작 시각과 맞는 세션의 usage 필드
    - Codex: 세션의 token_count
  - 집계 방식은 `scripts/claude_usage_by_session.py`와 같습니다.
- **설치/코드:** 없음 / **있음**
- **되돌리기:** 백업 복원. 추가된 테이블은 그대로 둬도 다른 동작에 영향이 없습니다(필요하면 `DROP TABLE job_usage`).

---

### 권장 적용 순서

1. C1~C3 (자료 준비)
2. C4~C6 (프롬프트)
3. C7~C10 (봇 규칙)
4. 측정 1회 (`troubleshooting.md` 8장)
5. C13 → C11 → C12 (브리지 코드)

브리지 코드는 측정 결과를 본 뒤 손대는 것을 권합니다.
