<!-- naru-orch job=P3-3-design-system-review-01 provider=antigravity model=gemini-4-hydrogen-medium agent=b74d2201-e50f-464b-ad81-b2f3a2a207ef copied=2026-11-19T12:54+09:00 note=save-result는 docs/01-planning 아래로만 복사 가능해 브리지 대신 이 경로에 최종 답을 복사함. 스냅샷 절대경로 링크는 워크트리 상대 경로로 바꿈. -->

# NaruWorks 디자인 시스템(승인② 초안) 독립 검토 결과

## 1. 요약
- **판정**: **수정 필요** (브랜드 A 일관성, 라이트/다크 31개 토큰 패리티, 문서 내 기재된 85개 WCAG AA 대비 계산은 모두 정확하나, **문서에서 누락된 실제 사용 조합의 대비 미달 1건**과 **와이어프레임 대비 컴포넌트/모바일 변형 누락 2건**이 확인됨)
- **심각도별 개수**: `blocking` **0건** / `major` **3건** / `minor` **3건**

---

## 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
|---|---|---|---|---|---|
| 1 | `major` | [design-system.md](design-system.md#L241-L245), [components-buttons-light.png](exports/components-buttons-light.png) | **라이트 `border-strong` / `surface-pressed` 대비 3:1 미달 및 검사 누락** | `Secondary` 버튼 및 `Icon button`의 `눌림(pressed)` 상태에서 `surface-pressed`(`#DCE6F4`) 배경 위에 `border-strong`(`#79889E`) 경계를 사용하나, 재계산 시 **2.86:1**로 WCAG AA 비텍스트 대비(3:1)에 미달함. 대비 표에는 `bg`/`surface`/`surface-hover`/`surface-raised`만 검사되고 `surface-pressed`가 빠져 있음. | 라이트 `border-strong` 명도를 낮추거나(예: `#75849A` 이하 검토) `surface-pressed`를 약간 밝게 조정해 3:1 이상을 확보하고, 대비 표에 `border-strong / surface-pressed` 쌍을 추가한다. |
| 2 | `major` | [components-shell-light.png](exports/components-shell-light.png), [WF-08.png](../../01-planning/wireframe/exports/WF-08.png) | **비회원 공통 헤더(`Common header` guest 변형) 항목 누락** | `WF-08` 화면 및 주석 ⑤(`DEC-076`)에서는 비회원 헤더에도 `로고`, `서비스 전환 메뉴`, `문서`, `저장소`, `로그인`을 모두 두고 비회원 클릭 시 `WF-01`로 이동하도록 정의했으나, 디자인 시스템의 `desktop-guest`·`mobile-guest`에는 `NaruWorks` 로고와 `로그인` 버튼만 있고 `서비스 전환`·`카테고리`가 없음. | `Common header`의 `guest` 변형(데스크톱 및 모바일 드로어)에 `서비스 전환`·`카테고리(문서·저장소)`를 포함하고, 비회원 클릭 시 `WF-01` 이동 동작을 명시하거나 기획과 일치하도록 정리한다. |
| 3 | `major` | [design-system.md](design-system.md#L154-L185), [WF-05.png](../../01-planning/wireframe/exports/WF-05.png) | **드라이브 좌측 메뉴(`내 드라이브` / `휴지통`) 컴포넌트 및 모바일 전환 변형 누락** | `WF-05` ④ 왼쪽 메뉴(`내 드라이브 (현재 위치)`, `휴지통`)는 `WF-06` 휴지통 진입의 유일한 경로이나, 디자인 시스템 인벤토리에 사이드바/서브 내비게이션 컴포넌트가 없고 `Common header` 모바일 드로어에도 `휴지통` 진입 항목이 빠져 있어 모바일에서 휴지통 이동 수단이 불명확함. | 드라이브 좌측 내비게이션(예: Side nav / Drive nav)과 모바일 전환 변형(상단 세그먼트/탭 또는 모바일 메뉴 내 드라이브 하위 항목)을 컴포넌트 인벤토리에 추가한다. |
| 4 | `minor` | [design-system.md](design-system.md#L199), [design-system.md](design-system.md#L239-L240) | **라이트 `warning` / `surface` 대비 미세 미달(4.4990:1) 및 표 미기재** | 문서 199행은 "판정은 반올림 전 값을 사용한다"고 명시함. `warning`(`#9A6700`) / `surface`(`#F4F6FA`)의 정확한 대비율은 **4.4990:1**로 4.5:1에 0.001 미달함. 문서에는 `warning-subtle`·`surface-raised`만 검사되어 있음. | `warning`을 `surface` 위에 직접 쓰지 않도록 용도를 제한하거나, 라이트 `warning` 명도를 한 단계 낮춰(예: `#996600` 등) `surface` 위에서도 4.5:1 이상을 넘기도록 조정한다. |
| 5 | `minor` | [design-system.md](design-system.md#L176), [WF-03.png](../../01-planning/wireframe/exports/WF-03.png), [WF-05.png](../../01-planning/wireframe/exports/WF-05.png) | **입력·폴더 선택용 `Dialog` 및 `WF-03` 폴더 선택 상태 조합 안내 부족** | `Dialog / Modal` 변형이 `confirm · destructive · link · license`로만 예시되어 있어 `WF-05`의 `폴더 만들기`, `이름 변경`, `이동(대상 폴더 선택)`에 필요한 입력/목록 포함 모달 조합이 드러나지 않음. `WF-03`의 폴더 목록 선택 상태도 `File list row`의 `folder` 변형으로만 암시됨. | `Dialog` 또는 적용 지침에 `Text field`·폴더 목록(`File list row` `selected`)을 조합하는 패턴을 명시한다. |
| 6 | `minor` | [design-system.md](design-system.md#L177), [WF-07.png](../../01-planning/wireframe/exports/WF-07.png) | **`WF-07` 회원 공유의 페이지/모달 표현 차이** | `WF-07` 와이어프레임은 공통 헤더·푸터가 있는 독립 화면(권한 선택은 `Radio` 형태)으로 구성되어 있으나, 디자인 시스템은 이를 `Share dialog` 모달(권한 선택은 `Select / Dropdown` 형태)로만 정의함. | `Share dialog`의 내부 폼을 `WF-07` 독립 화면 패널로도 재사용할 수 있음을 주석에 명시한다. |

---

## 3. 토큰 패리티·대비 재계산 요약

### 라이트/다크 토큰 패리티 및 파일 간 일치
- [design-system.md](design-system.md), [tokens.json](tokens.json), [design-system.figcraft](design-system.figcraft) (`Deep Ink` 컬렉션 `Light`/`Dark` 모드) 모두 **31개 시맨틱 컬러 토큰이 양쪽 모드에 빠짐없이 존재하며, 키 이름과 HEX/RGBA 값이 100% 일치**한다.
- 타이포그래피, 4px 스페이싱, 라디우스, 엘리베이션(라이트/다크 3단계), 브레이크포인트/그리드, 모션, 컨트롤 크기 역시 `design-system.md`와 `tokens.json` 간 불일치가 없다.

### 브랜드 A (Deep Ink) 일관성
- [design-decisions.md](../design-decisions.md)의 `DES-002` 및 [brand-concepts.md](../brand/brand-concepts.md) 시안 A의 `primary`(`#1E3A5F` / `#8DB4F5`), `on-primary` 등 13개 기본 팔레트, 글꼴(`IBM Plex Sans KR` + `IBM Plex Sans`), 아치+수면선 로고([symbol.svg](assets/symbol.svg), [logo-light.svg](assets/logo-light.svg), [logo-dark.svg](assets/logo-dark.svg))가 정확히 유지되었으며, 거절된 B·C 시안이나 Grove Mint/NA 모노그램 흔적은 없다.

### WCAG AA 대비 재계산 결과
- 문서에 기재된 **85개 쌍(검증 81개 + 장식 참고 4개, 총 170개 라이트/다크 수치)**을 sRGB 상대 휘도 공식으로 전수 재검산한 결과 **문서 수치와 다른 값이나, 미달을 통과로 잘못 표기한 항목은 0건**이었다.
- 다만 **문서 표에서 누락된 실제 사용/잠재 조합**을 추가 계산한 결과 아래 실패·주의 쌍이 확인되었다:

| 전경 / 배경 | 모드 | 기준 | 재계산 수치 | 판정 | 비고 |
|---|---|---|---|---|---|
| `border-strong` / `surface-pressed` | 라이트 | 3:1 | **2.86:1** | **미달** | `Secondary` 버튼 및 `Icon button`의 `눌림` 상태에서 실제 사용됨 |
| `warning` / `surface` | 라이트 | 4.5:1 | **4.4990:1** | **미달** | 문서 기준(반올림 전 판정)에 0.001 미달; 표에 미기재 |
| `secondary` / `surface-raised` | 다크 | 4.5:1 (텍스트 시) | **4.39:1** | 텍스트 시 미달 / 그래픽(3:1) 통과 | 보조 그래픽 전용이므로 텍스트로 오용 금지 |

---

## 4. WF-01~16 대비 빠진 UI 요소 목록
- **WF-05 (나루 드라이브)**: ④ 왼쪽 메뉴(`내 드라이브 (현재 위치)`, `휴지통`) 전환용 사이드바/내비게이션 컴포넌트 및 모바일에서 `휴지통`으로 이동하는 UI 변형 누락.
- **WF-08 (링크 보기)**: ⑤ 비회원 공통 헤더의 `서비스 전환 메뉴`, `문서`, `저장소` 항목이 디자인 시스템 `Common header`의 `desktop-guest`·`mobile-guest` 변형에서 누락됨.
- *(그 외 WF-01~04, WF-06, WF-07, WF-09~16의 버튼, 입력 필드, 라디오/체크박스/토글/셀렉트, 관리자 테이블, 휴지통 행, 업로드 진행, 모달, 바텀시트, 푸터, 모바일 비호버 파일 카드/행 등은 모두 디자인 시스템 컴포넌트 또는 명시적 조합으로 다뤄지고 있음.)*

---

## 5. 검토하지 못한 부분과 그 이유
- **FigCraft 내부 컴포넌트 인스턴스·노드별 상세 속성 전수 검사 [미확인]**: `design-system.figcraft`의 변수 컬렉션(31개 토큰)과 11개 페이지/22개 프레임 구조는 ZIP 내부 `document.json`으로 직접 확인했으나, 각 컴포넌트 인스턴스의 개별 바인딩·오토레이아웃·패딩 수치는 FigCraft 전용 GUI 도구가 없어 `exports/*.png` 시각 검사와 `tokens.json`·`design-system.md` 대조로 대체하였다.
- **실제 웹 폰트(`IBM Plex Sans KR`) 렌더링 자간/행간 [미확인]**: [design-system.md](design-system.md#L55)에 명시된 대로 헤드리스 렌더러에 해당 폰트가 설치되어 있지 않아 PNG 내 일반 텍스트는 대체 글꼴로 렌더링되어 있으며, 실제 웹 환경에서의 글꼴 메트릭은 브라우저 구현 단계에서 확인이 필요하다.
- **다크 모드 전수 PNG 중 일부(`foundations-dark.png`, `components-buttons-dark.png`, `components-inputs-dark.png`, `components-navigation-dark.png`, `components-feedback-dark.png`, `components-overlays-dark.png`, `components-data-dark.png`, `contrast-dark.png`, `icons-*.png`)**: 토큰 패리티와 대비율은 JSON·FigCraft 변수 기준으로 전수 검증했고 `components-shell-dark.png`는 직접 확인했으나, 나머지 다크 모드 PNG의 개별 픽셀 레이아웃까지는 모두 열람하지 않았다 [미확인].
