# FigCraft 명령 요약표 (C2)

작성·수정 잡은 이 표를 먼저 본다. `list_commands`는 **이 표에 없는 명령이 필요할 때만, 필터를 걸어 1회** 부른다(예: `{"filter":"variable"}`).

- 근거: 2026-11-19~20 P3-3·P3-4 잡 로그의 실제 호출(성공 예)과 `list_commands`가 돌려준 명령 설명. 서명은 그때 기준이며 FigCraft가 바뀌면 다시 확인한다.
- 호출 빈도(P3 잡 합계): export 260 · batch 224 · screenshot 146 · get_node 125 · run_command 53 · list_commands 33

## 1. MCP 도구

| 도구 | 쓰는 때 | 예 |
|---|---|---|
| `open_file` / `save_file` | 파일 열기·저장 | `{"path":".../screens-wf13-16.figcraft"}` / `{}` |
| `batch` | 여러 명령을 한 번에(권장) | `{"commands":[ {...}, {...} ]}` |
| `run_command` | 명령 1개 | `{"command":"variable.list"}` |
| `get_node` | 중간 확인(필요한 필드만) | `{"id":24,"depth":1}` — depth는 1~2로 작게 |
| `inspect_document` | 페이지·프레임 목록 | `{"depth":1,"fields":["name","type","x","y","width","height"]}` |
| `screenshot` | 프레임 완성 뒤 1회 렌더 확인 | `{"ids":[228],"maxSize":1000}` — **maxSize 1000 이하** |
| `export` | PNG 내보내기 | `{"ids":[202],"path":".../exports/wf13-16/WF-14-...-light.png"}` |
| `set_properties` | 노드 1개 속성 | `{"ids":[12847],"props":{"sizingV":"fixed","height":340}}` |

## 2. 자주 쓰는 명령 (batch / run_command 안)

| 명령 | 파라미터 요지 | 예 |
|---|---|---|
| `node.create` | `type`(frame·text·rectangle·vector…), `name`, `parent`, `x`,`y`,`width`,`height`, `props`{node.set 키}, `select` | `{"command":"node.create","as":"root","params":{"type":"frame","name":"WF-01-login-desktop-light","width":1440,"height":900,"props":{"layout":"vertical","fill":{"$var":"bg"}}}}` |
| `node.set` | `ids`, `props` | `{"command":"node.set","params":{"ids":[245],"props":{"characters":"카테고리 추가"}}}` |
| `edit.duplicate` | `ids`, `dx`,`dy`, `map` | `{"command":"edit.duplicate","as":"dA","params":{"ids":[11077],"dx":0,"dy":1120,"map":true}}` |
| `instance.create` | `component`, `x`,`y` | `{"command":"instance.create","as":"i","params":{"component":505,"x":0,"y":400}}` |
| `component.detach` | `ids` | `{"command":"component.detach","params":{"ids":[{"$ref":"i"}]}}` |
| `node.reparent` | `ids`, `parent` | `{"command":"node.reparent","params":{"ids":[{"$ref":"hd","field":"ids/0"}],"parent":<부모 id>}}` |
| `node.find` | `root`, `text`, `type` | `{"command":"node.find","params":{"root":1079,"text":"문서","type":"text"}}` |
| `variable.create` | `collection`,`name`,`type`,`values`{모드:값} | `{"command":"variable.create","params":{"collection":"color","name":"bg","type":"color","values":{"Light":"#FFFFFF","Dark":"#0B1220"}}}` |
| `variable.bind` | `ids`, `field`, `variable` | `{"command":"variable.bind","params":{"ids":[11424],"field":"stroke","variable":"primary"}}` |
| `variable.setMode` / `variable.list` | 모드 전환 / 목록 | `{"command":"variable.list"}` |
| `page.add` / `page.select` | 페이지 | `{"command":"page.select","params":{"id":11026}}` |
| `edit.delete` | `ids` | `{"command":"edit.delete","params":{"ids":[11152,11160]}}` |
| `file.export` | `ids`, `format`, `scale`, `path` | `{"command":"file.export","params":{"ids":[11077],"format":"png","scale":1,"path":"..."}}` |

## 3. 주의 (지난 잡에서 오류가 났던 것)

| 항목 | 규칙 |
|---|---|
| 지우기 | `node.delete`는 **없는 명령**이다. `edit.delete {ids}`를 쓴다. |
| 내보내기 형식 | 형식 값은 소문자 `png`(`PNG`는 오류). |
| `$ref` | 앞 명령에 `"as":"이름"`을 붙이고 뒤에서 `{"$ref":"이름"}` 또는 여러 id면 `{"$ref":"이름","field":"ids/0"}`. 같은 batch 안에서만 유효. |
| padding·gap·mainAlign·crossAlign | **auto layout 프레임**(`layout`: horizontal·vertical·grid)에만 적용된다. 일반 프레임에 주면 오류·무시. |
| `textAlignVertical` | 텍스트 노드 속성이다(값 표기는 `list_commands {"filter":"text"}`로 1회 확인). 프레임 정렬은 `mainAlign`/`crossAlign`. |
| `sizingH`/`sizingV` | `fixed`·`hug`·`fill`. 부모가 auto layout일 때 의미가 있다. |
| 색 바인딩 | `fill`/`stroke`에 `{"$var":"토큰명"}`. 원시 hex는 토큰 정의(`variable.create`)에서만. |
| export 폴더 | 폴더가 없으면 실패한다. 작은 플레이스홀더 파일로 폴더를 먼저 만든 뒤 재시도. |
| get_node 깊이 | `depth` 3 이상은 결과가 커져 맥락을 키운다. 1~2로 시작해 필요한 노드만 다시 본다. |
