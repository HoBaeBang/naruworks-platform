# 디자인 잡 프롬프트 작성 규칙 (C4~C6)

디자인 봇이 브리지(naru-orch) 잡의 `prompt.md`를 쓸 때 따르는 규칙. 별도 템플릿 파일이 없어 이 문서를 기준으로 한다.
근거: `docs/troubleshooting/2026-11-token-overuse/troubleshooting.md` 5~6장.

입력 파일(이 폴더): `design-rules-summary.md`(C1), `figcraft-cheatsheet.md`(C2), `excerpts/WF-NN.md`(C3).

## C4. 작성 잡 (P3-4형 화면 시안)

| 지금(2026-11-20 P3-4 기준) | 바꾼 후 |
|---|---|
| "0단계 — 다섯 스킬을 실제로 로드"(Skill 5회 + 참조 파일 Read) | "0단계 — `design-rules-summary.md`만 Read". 요약에 없는 판단만 해당 스킬 절을 1회 Read |
| 「인라인: Web Interface Guidelines」 전문 13.6~16.7KB | **삭제.** 필요한 규칙은 요약본 2·5·6장에 있음 |
| `screens.md`·`screen-data-actions.md` 전체 Read | 이번 화면의 `excerpts/WF-NN.md`만. 이어받을 시각 언어는 직전 묶음 PNG 1~2장과 그 묶음 절 이름만 적는다 |
| `list_commands`로 명령 탐색 | `figcraft-cheatsheet.md` 참조. 표에 없을 때만 필터를 걸어 1회 |
| 화면 4개 한 묶음 | **화면 1~2개 한 잡**(C7) |

프롬프트에 그대로 넣을 문장:

```
## 0단계 — 입력
1. <저장소>/docs/design/agent-inputs/design-rules-summary.md 를 Read 한다. 다섯 디자인 스킬 원문은 로드하지 않는다.
   요약에 없는 판단이 필요하면 해당 스킬의 그 절만 1회 Read 하고, 최종 답에 그 이유를 적는다.
2. 이번 화면의 발췌 <저장소>/docs/design/agent-inputs/excerpts/WF-NN.md 만 Read 한다. screens.md·screen-data-actions.md 전체를 읽지 않는다.
3. FigCraft 명령은 <저장소>/docs/design/agent-inputs/figcraft-cheatsheet.md 를 본다. list_commands 는 표에 없는 명령이 필요할 때만 filter 를 걸어 1회.
```

## C5. 스크린샷·확인 규칙 (작성 잡 「도구 제한」 절에 추가)

```
- figcraft screenshot 은 프레임마다 완성 뒤 1회, maxSize 1000 이하로 찍는다. 같은 프레임을 다시 찍는 것은 수정 뒤 1회까지.
- 중간 확인은 get_node(depth 1~2, 필요한 노드만)로 한다.
- export 한 PNG 를 Read 로 다시 열지 않는다. 시각 검수는 검수 잡에서 한다.
```

## C6. 검수 잡 (review-NN)

```
- 첫 검수: 이번 묶음 PNG 와 해당 excerpts/WF-NN.md, design-rules-summary.md 만 입력으로 준다.
- 재검수: 직전 검수의 지적 목록(표)과 **바뀐 프레임 PNG 만** 넣는다. 바뀌지 않은 화면은 다시 넣지 않는다.
- 출력: 「막는 문제 / 주요 / 경미」 3열 표, 전체 2KB 이내. 근거는 파일명·프레임명으로만 적고 원문을 길게 인용하지 않는다.
```

## 되돌리기

이 문서를 쓰기 전 형식은 `~/.naru-orch/jobs/P3-4-screens-wf13-16-01/prompt.md`(작성), `~/.naru-orch/jobs/P3-4-screens-wf13-16-review-13/prompt.md`(검수)에 남아 있다.
