<!-- naru-orch job=P3-3-design-system-review-02 provider=antigravity model=gemini-4-hydrogen-medium agent=f142c7f8-b13d-4bad-aa04-217f0b5714da copied=2026-11-19T13:18+09:00 note=save-result는 docs/01-planning 아래로만 복사 가능해 브리지 대신 이 경로에 최종 답을 복사함. 스냅샷 절대경로 링크는 워크트리 상대 경로로 바꿈. -->

# NaruWorks 디자인 시스템(승인②, v0.2 검수 반영) 독립 재검토 결과

## 1. 요약
- **판정**: **통과**
- **심각도별 개수**: `blocking` **0건** / `major` **0건** / `minor` **0건**

[review-01.md](review-01.md)에서 지적한 6건과 추가 확인 항목(다크 `secondary` / `surface-raised` 4.39:1 처리)이 [design-system.md](design-system.md), [tokens.json](tokens.json), [design-system.figcraft](design-system.figcraft), 및 내보내기 PNG(`exports/*.png`) 전반에 일관되게 반영되었음을 확인했다.

---

## 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
|---|---|---|---|---|---|
| - | - | - | 신규 발견 사항 없음 | 토큰 패리티, WCAG AA 대비 재계산, WF-01~16 컴포넌트·모바일 커버리지, 브랜드 A 일관성 모두 기준 충족 | - |

---

## 3. 이전 지적 7건의 재확인 결과

| 번호 | 원 심각도 | 항목 | 재확인 판정 | 근거 |
|---|---|---|---|---|
| 1 | `major` | 라이트 `border-strong` / `surface-pressed` 대비 3:1 미만 및 표 누락 | **해소** | 라이트 `border-strong`이 `#79889E` → `#738298`로 변경됨. `surface-pressed`(`#DCE6F4`) 대비 재계산 시 라이트 **3.1008:1**(표기 `3.10:1`), 다크(`#7487A3` / `#2B3851`) **3.2101:1**(표기 `3.21:1`)로 UI 3:1 기준을 통과함. [design-system.md](design-system.md#L251), [design-system.md](design-system.md#L414), [components-buttons-light.png](exports/components-buttons-light.png), [contrast-light.png](exports/contrast-light.png)에 반영됨. |
| 2 | `major` | WF-08 비회원 공통 헤더 항목 누락 | **해소** | `Common header`의 `desktop-guest · 기본`, `mobile-guest · 기본`, `mobile-guest · 메뉴 열림`에 모두 로고, 서비스 전환, 문서, 저장소, 로그인 버튼이 추가되었으며 클릭 시 WF-01 이동(DEC-071·076)이 명시됨. [components-shell-light.png](exports/components-shell-light.png), [components-shell-dark.png](exports/components-shell-dark.png), [design-system.md](design-system.md#L185), [design-system.md](design-system.md#L435)에서 확인함. |
| 3 | `major` | WF-05 드라이브 사이드 내비게이션 및 모바일 휴지통 진입 UI 누락 | **해소** | `Drive navigation` 컴포넌트(`데스크톱 사이드바` / `모바일 드라이브 메뉴` × `내 드라이브` / `휴지통`, `aria-current="page"`)가 추가됨. WF-05/WF-06 범위를 넘는 기능(최근 항목, 공유 문서함 등)은 추가되지 않음. [components-navigation-light.png](exports/components-navigation-light.png), [components-navigation-dark.png](exports/components-navigation-dark.png), [design-system.md](design-system.md#L167), [design-system.md](design-system.md#L436)에서 확인함. |
| 4 | `minor` | 라이트 `warning` / `surface` 반올림 전 4.5:1 미달 | **해소** | 라이트 `warning`이 `#9A6700` → `#8C5900`으로 변경됨. 재계산 시 `surface`(`#F4F6FA`) 대비 **5.4766:1**(표기 `5.48:1`), 최악 배경인 `surface-pressed`(`#DCE6F4`) 대비 **4.7032:1**(표기 `4.70:1`)로 모든 텍스트 배경에서 반올림 전 4.5:1 이상을 충족하며, 표가 갱신됨. [design-system.md](design-system.md#L240-L245), [design-system.md](design-system.md#L415-L420)에서 확인함. |
| 5 | `minor` | 입력 대화상자·폴더 선택 대화상자 안내 및 예시 부족 | **해소** | `Overlays` 보드에 `Dialog / Folder workflows`(`WF-05 · 폴더 만들기`, `WF-05 · 이름 변경`, `WF-03 · 저장 폴더 선택`, `WF-05 · 이동할 폴더 선택`)가 추가되고, `Data` 보드 `File list row`에 `folder · selected` 변형이 추가됨. 빈 이름/중복 이름 오류, 자기 자신·하위 폴더 제외, 포커스 복귀 지침도 명시됨. [components-overlays-light.png](exports/components-overlays-light.png), [components-overlays-dark.png](exports/components-overlays-dark.png), [components-data-light.png](exports/components-data-light.png), [design-system.md](design-system.md#L437). |
| 6 | `minor` | WF-07 회원 공유 독립 화면 및 Radio 권한 선택 | **해소** | `Shell` 보드에 `Member sharing page`(`desktop · WF-07`, `mobile · WF-07`)가 추가되어 공통 헤더·푸터가 포함된 독립 화면 및 `Radio`(보기/편집), `다운로드 허용` 체크박스, `공유 중인 회원` 목록/취소 UI가 WF-07 와이어프레임과 일치함. 기존 `Share dialog`는 WF-05 상태 D 링크 공유 설정 모달 용도로 구분됨. [components-shell-light.png](exports/components-shell-light.png), [components-shell-dark.png](exports/components-shell-dark.png), [design-system.md](design-system.md#L178), [design-system.md](design-system.md#L438). |
| 7 | `추가` | 다크 `secondary` / `surface-raised` 4.39:1 처리 | **해소** | `secondary`를 "보조 그래픽·진행 표시 전용(텍스트 금지)"으로 명확히 제한하고, 다크 `surface-raised` 대비 **4.3901:1** 및 `surface-hover`(3.7124:1)·`surface-pressed`(3.4835:1)가 UI 그래픽 3:1 기준을 통과함을 문서화함. [design-system.md](design-system.md#L26), [design-system.md](design-system.md#L302-L305), [design-system.md](design-system.md#L422-L429). |

---

## 4. 토큰 패리티·대비 재계산 요약

### 라이트/다크 토큰 완전성과 파일 간 일치
- [design-system.md](design-system.md)(본문 표·전달용 코드 블록), [tokens.json](tokens.json)(`color.light` / `color.dark`), [design-system.figcraft](design-system.figcraft)(`Deep Ink` 컬렉션 `Light`/`Dark` 모드) 모두 **31개 시맨틱 컬러 토큰이 양쪽 모드에 빠짐없이 존재하며, 키 이름과 HEX/RGBA 값이 100% 일치**함.
- v0.2 HEX 변경 내역(라이트):
  - `border-strong`: `#79889E` → `#738298` (다크 `#7487A3` 유지)
  - `warning`: `#9A6700` → `#8C5900` (다크 `#E5B03C` 유지)

### 브랜드 A (Deep Ink) 일관성
- [design-decisions.md](../design-decisions.md) `DES-002` 및 [brand-concepts.md](../brand/brand-concepts.md) 시안 A의 `primary`(`#1E3A5F` / `#8DB4F5`), `accent`(`#D4A24C` / `#E3B866`), `IBM Plex Sans KR` + `IBM Plex Sans`, 아치+수면선 심볼([symbol.svg](assets/symbol.svg), [logo-light.svg](assets/logo-light.svg))이 유지되었으며 거절된 B·C 시안이나 Grove Mint/NA 모노그램 흔적은 없음.

### WCAG AA 대비 재계산 결과
- [design-system.md](design-system.md)의 검증 표 **86개 쌍**, 장식 참고 표 **7개 쌍**, v0.2 검증 표 **15개 쌍**을 sRGB 상대 휘도 공식으로 전수 재검산한 결과 **문서 수치와 불일치하거나 반올림 전 값 기준 미달을 통과로 표기한 항목은 0건**임.
- 주요 변경·검증 쌍(반올림 전 4자리):

| 전경 / 배경 | 기준 | 라이트 재계산 | 다크 재계산 | 판정 |
|---|---|---|---|---|
| `border-strong` / `surface-pressed` | UI 3:1 | `3.1008:1` | `3.2101:1` | 통과 |
| `warning` / `surface` | 텍스트 4.5:1 | `5.4766:1` | `8.5201:1` | 통과 |
| `warning` / `surface-pressed` | 텍스트 4.5:1 | `4.7032:1` | `5.9350:1` (`5.93496`) | 통과 |
| `secondary` / `surface-raised` | 그래픽 3:1 (텍스트 금지) | `5.1151:1` | `4.3901:1` | 그래픽 통과 / 텍스트 금지 명시 |

*(참고: `success / surface-pressed`(라이트 `4.2269:1`)와 `error / surface-pressed`(다크 `4.2408:1`)는 진행 막대 그래픽(3:1) 용도로만 검증되어 있으며 텍스트 용도로 사용하지 않음.)*

---

## 5. WF-01~16 대비 빠진 UI 요소 목록
- **없음.** `WF-01~16`의 공통 헤더(회원·관리자·비회원 데스크톱/모바일), 공통 푸터, 드라이브 내비게이션(`내 드라이브` / `휴지통`), 파일 목록/그리드(모바일 비호버 유형 표시 포함), 폴더 만들기·이름 변경·저장 폴더 선택·이동 대상 선택 대화상자, 회원 공유 독립 화면(Radio 권한) 및 링크 공유 모달, 휴지통, 업로드 진행/취소, 관리자 테이블, 바텀시트 등이 모두 디자인 시스템 컴포넌트 및 명시적 조합으로 다뤄지고 있다.

---

## 6. 검토하지 못한 부분과 그 이유
- **FigCraft 내부 컴포넌트 인스턴스·노드별 상세 바인딩·오토레이아웃 수치 [미확인]**: [design-system.figcraft](design-system.figcraft)의 11개 페이지·22개 프레임 구조와 31개 변수 컬렉션은 ZIP 내 `document.json`으로 직접 확인했으나, FigCraft 전용 GUI 도구가 없어 개별 컴포넌트 인스턴스의 오토레이아웃·패딩 등은 내보내기 PNG 시각 검사와 [tokens.json](tokens.json)·[design-system.md](design-system.md) 대조로 대체하였다.
- **실제 웹 폰트(`IBM Plex Sans KR`) 렌더링 메트릭 [미확인]**: [design-system.md](design-system.md#L55)에 명시된 대로 헤드리스 렌더러에 해당 폰트가 설치되어 있지 않아 PNG 내 일반 텍스트는 대체 글꼴로 렌더링되어 있으며, 실제 브라우저 구현 단계에서 확인이 필요하다.
- **일부 다크 모드 PNG 시각 열람 [미확인]**: v0.2에서 핵심 수정이 이루어진 `components-shell-dark.png`, `components-navigation-dark.png`, `components-overlays-dark.png`는 직접 열람해 확인했으나, 나머지 다크 모드 PNG(`foundations-dark.png`, `components-buttons-dark.png`, `components-data-dark.png`, `contrast-dark.png`, `icons-*.png`, `brand-assets-*.png`)의 픽셀 레이아웃까지는 전수 열람하지 않았다(토큰 및 대비율은 JSON·FigCraft 변수 기준으로 전수 검증 완료).
