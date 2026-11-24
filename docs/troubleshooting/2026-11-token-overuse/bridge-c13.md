# C13 적용 기록 · 브리지 v0.1.7 잡별 토큰 사용량

- 적용: 2026-11-25 00:28 KST, Mac `~/.naru-orch/bin/naru_orch.py` (저장소 밖)
- 변경: v0.1.6 → v0.1.7. 전체 diff는 `bridge-v0.1.7-job-usage.diff`.
- sha256: v0.1.6 `b1eedd3c…01db43` → v0.1.7 `2a8a3f42…956058`
- 백업: `~/.naru-orch/bin/naru_orch.py.bak-v0.1.6`, `~/.naru-orch/state.db.bak-v0.1.6`
- 설치·설정 변경·서비스 실행: 없음(표준 라이브러리만, `config.json` 변경 없음).

## 동작

- state.db에 `job_usage` 표(job_id, provider, session, api_calls, input, output, cache_creation, cache_read, ctx_max, recorded_at) 추가. 숫자만 저장하고 대화 내용은 저장하지 않는다.
- 잡이 done·failed·timeout이 되거나 한도 소진으로 다른 LLM에 넘기기 직전에, 같은 작업 폴더에서 잡 시간대(시작 2분 전 ~ 마지막 갱신)에 시작한 세션을 읽어 기록한다.
  - Claude: `~/.claude/projects/<cwd의 영숫자 외 문자를 -로 바꾼 이름>/*.jsonl`의 `usage` (메시지 id·requestId 기준 중복 제거)
  - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`의 `token_count` (cached_input → cache_read)
  - Gemini(antigravity): 사용량 필드 미확인으로 기록하지 않음.
- 조회: `naru-orch usage <job_id> [--refresh]`. 집계 실패는 잡 상태에 영향 없이 `jobs/<id>/job.log`에만 남긴다.

## 실측 확인 (2026-11-25, 지난 잡에 --refresh)

| 잡 | 세션 | 호출 | cache_read | ctx_max |
|---|---|---|---|---|
| P3-3-design-system-icons-02 | claude 1 | 26 | 2,853,255 | 140,685 |
| P3-4-screens-wf13-16-03 | claude 1 | 25 | 3,485,321 | 195,052 |
| P3-4-screens-wf13-16-02 (Claude 소진 → Codex) | claude 1 + codex 1 | 4 + 13 | 131,374 + 576,640 | 78,245 / 61,027 |

## 되돌리기

`cp ~/.naru-orch/bin/naru_orch.py.bak-v0.1.6 ~/.naru-orch/bin/naru_orch.py`. `job_usage` 표는 남겨도 v0.1.6 동작에 영향이 없다(필요하면 `DROP TABLE job_usage`).
