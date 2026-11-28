<!-- naru-orch job=P3-3-design-system-icons-review-04 provider=antigravity model=gemini-4-hydrogen-medium agent=aa37b4e1-cc48-4d62-8c28-c234a3875abd saved=2026-11-20T14:06:42+09:00 -->

### 1. 요약

- **판정:** **경미**
- **발견 건수:** blocking 0건 · major 0건 · minor 1건

`plus`·`error` 두 아이콘이 `design-system.md`, `icons/` SVG, `design-system.figcraft`, `exports/icons-light.png`·`icons-dark.png` 전반에 39종 세트 규격(24×24, 스트로크 1.75px, 라운드 캡·조인, `currentColor`, Deep Ink 라이트/다크)에 맞게 일관되게 반영되었습니다. 기존 37종 회귀나 라이트/다크 붕괴는 관찰되지 않았습니다.

---

### 2. 발견 목록 표

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | [icons-light.png](../../../docs/03-ui-design/design-system/exports/icons-light.png), [icons-dark.png](../../../docs/03-ui-design/design-system/exports/icons-dark.png) | 아이콘 시트 PNG가 2x 배율(`2240×2080`)로 내보내져 기존 1x 시트(`1320×1800` 등)와 해상도 배율이 다름 | `Icons · Light` / `Icons · Dark` 보드 크기는 `1120×1040`이나 PNG는 `2240×2080`이며, `foundations-light.png` 등은 `1320×1800` 1x로 내보내짐 | 시트 간 배율 통일이 필요하면 차후 일괄 내보내기 시 1x 또는 2x로 기준을 맞춤 |

> 참고: [design-system.md](../../../docs/03-ui-design/design-system/design-system.md#L379-L381) 379행에 `원본 커스텀 아이콘 37개로 교체했다`는 문구가 남아 있으나, 이는 v0.3 초기 도입 이력 서술이며 바로 아래 381행에 `plus(추가)와 error(오류)를 세트에 더해 39개가 되었다`로 이어지므로 현재 세트 표기 오류는 아닙니다.

---

### 3. 39종 표·파일·컴포넌트·시트 일치 결과

- **문서([design-system.md](../../../docs/03-ui-design/design-system/design-system.md)):**
  - 본문(108행) `커스텀 아이콘 세트 39개`, 산출물 목록(366행) `아이콘 SVG 39개`, v0.3 기록(381행) 모두 39종으로 갱신되어 있습니다.
  - 용도 표(114~154행)에 `추가 | plus`(153행), `오류 | error`(154행)를 포함해 총 39개 행이 존재합니다.
- **SVG 파일([icons/](../../../docs/03-ui-design/design-system/icons/)):**
  - 총 39개 `.svg` 파일이 있으며, 용도 표의 39개 영문 이름과 1:1로 일치합니다.
  - [plus.svg](../../../docs/03-ui-design/design-system/icons/plus.svg), [error.svg](../../../docs/03-ui-design/design-system/icons/error.svg)를 포함한 39개 SVG 모두 `viewBox="0 0 24 24"`, `stroke="currentColor"`, `stroke-width="1.75"`, `stroke-linecap="round"`, `stroke-linejoin="round"` 규격을 충족합니다.
- **FigCraft([design-system.figcraft](../../../docs/03-ui-design/design-system/design-system.figcraft)):**
  - `document.json` 내 `icon/*` 타입 `component` 노드가 정확히 39개이며, `icon/plus`(id `7843`), `icon/error`(id `7845`)를 포함해 39종 이름이 SVG 파일명과 모두 일치합니다.
  - 39개 컴포넌트 모두 크기 `24.0×24.0`, `stroke` (`weight: 1.75`, `cap_start/cap_end: round`, `join: round`), `bound.stroke: VariableID:6`으로 동일 규격이며, `icon/plus`와 `icon/error`의 벡터 좌표(`network`)도 각 SVG 마스터 패스와 일치합니다.
- **내보내기 시트([icons-light.png](../../../docs/03-ui-design/design-system/exports/icons-light.png), [icons-dark.png](../../../docs/03-ui-design/design-system/exports/icons-dark.png)):**
  - 두 시트 모두 마지막 행(7행) `진행 중 / loader` 다음 칸에 `추가 / plus`, `오류 / error`가 포함되어 총 39종이 순서·한글 용도·영문 이름 모두 문서 및 FigCraft 컴포넌트와 일치합니다.
  - 16·20·24px 세 크기 미리보기가 모두 정상 렌더링되어 있습니다.

---

### 4. 기존 37종 회귀 여부

- `icons-light.png`와 `icons-dark.png`에서 기존 37종의 이름, 한글 레이블, 16·20·24px 형태가 모두 누락이나 깨짐 없이 유지되어 있습니다.
- 39개 SVG 파일 및 FigCraft `icon/*` 컴포넌트 전체 검사에서도 기존 37종 규격 불일치나 누락은 발견되지 않았습니다.
- 기존 37개 SVG 파일의 이전 커밋 대비 내용 변경 여부는 git 히스토리를 조회하지 않아 `[미확인]`입니다(파일 수정 시각은 기존 37종 `Nov 19`, `plus.svg`·`error.svg`만 `Nov 20`으로 확인됨).

---

### 5. 라이트/다크 확인 결과

- `icons-light.png`와 `icons-dark.png`의 구성이 39종 1:1 패리티를 이룹니다.
- `icons-dark.png`에서 Deep Ink 다크 배경(`#0B1220` / 카드 `#141D2E`) 위에 39종 아이콘(16·20·24px)이 모두 밝은 잉크 색으로 선명하게 표시되며, 라이트 색상이 남아 보이지 않는 현상이나 붕괴는 없습니다.

---

### 6. 검토하지 못한 부분과 이유

- **git 히스토리 기반 기존 37종 파일 diff:** 읽기 전용 지침(git 명령 실행 금지)에 따라 확인하지 못했습니다(`[미확인]`).
- **FigCraft 데스크톱 앱 GUI 내 직접 렌더링 및 변수 바인딩 동작:** CLI 환경에서 `.figcraft` ZIP 내 `document.json` 데이터와 내보낸 PNG 결과물로만 검증했습니다(`[미확인]`).
