# 디자인 잡 입력 묶음 (토큰 절감)

디자인 봇의 브리지 잡이 매번 원문 대신 읽는 짧은 입력 파일. 도입 배경은 `docs/troubleshooting/2026-11-token-overuse/`.

| 파일 | 항목 | 대신하는 것 |
|---|---|---|
| `design-rules-summary.md` | C1 | 디자인 스킬 5종 원문 로드 + Web Interface Guidelines 인라인 |
| `figcraft-cheatsheet.md` | C2 | 잡마다 `list_commands` 탐색 |
| `excerpts/WF-NN.md` | C3 | `screens.md`(152KB)·`screen-data-actions.md`(59KB) 전체 읽기 |
| `prompt-rules.md` | C4~C6 | 작성·검수 잡 프롬프트 작성 규칙 |

발췌 다시 만들기(원본이 바뀌었을 때):

```
python3 docs/design/agent-inputs/excerpts/make_excerpts.py \
  <design-worktree>/docs/03-ui-design/screen-data/screen-data-actions.md \
  <design-worktree>/docs/03-ui-design/screens/screens.md \
  docs/design/agent-inputs/excerpts
```

현재 발췌는 2026-11-25 00:28 KST 기준 `naru-design`(feature/NARU-93-ui-design) 작업 폴더의 파일로 만들었다. 각 발췌 머리에 원본 sha256 앞 12자리가 있다.
