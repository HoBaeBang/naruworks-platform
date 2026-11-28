<!-- naru-orch job=P3-4-screens-wf05-08-review-10 provider=antigravity model=gemini-4-hydrogen-medium agent=03448c66-cd4f-456a-9bec-1ea6fb8a06c0 saved=2026-11-20T08:56:46+09:00 -->

### 1. 요약

- **판정:** **경미** (blocking **0** / major **0** / minor **1**)
- **지시된 6건 해소 여부:** 6건(major 2건, minor 4건) 모두 해소됨.
- **새 회귀 유무:** 없음.

---

### 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | WF-08 데스크톱/모바일 헤더, [screens.md](../../../docs/03-ui-design/screens/screens.md#L571) | WF-08 데스크톱 비회원 헤더 로그인 버튼 옆에 있는 `[문구 미확정]` 표기가 모바일 헤더에는 없으며, 문서에도 생략 사유가 없음(review-09 경미 4 잔존) | [WF-08-link-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-08-link-desktop-light.png), [WF-08-link-mobile-light.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-08-link-mobile-light.png) | 호배님 지시(고치지 말 것)에 따라 기록만 유지 |

---

### 3. 지시된 6건 확인 결과

1. **major 1 (WF-05 데스크톱 호버 썸네일 위치·크기) — 해소됨**
   - [WF-05-drive-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-05-drive-desktop-light.png), [WF-05-drive-desktop-dark.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-05-drive-desktop-dark.png)에서 호버 썸네일이 152×104 크기로 `현장 사진 03.jpg` 행의 이름과 「종류」 열 사이 여백에 배치되어 「종류」 열 텍스트를 가리지 않음.
   - [screens.md](../../../docs/03-ui-design/screens/screens.md#L481)의 설명(이름과 「종류」 열 사이 여백)과 화면이 일치하며, 모바일([WF-05-drive-mobile-light.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-05-drive-mobile-light.png), [WF-05-drive-mobile-dark.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-05-drive-mobile-dark.png))에는 호버 썸네일이 없음(DEC-084).

2. **major 2 (WF-08 모바일 비회원 헤더 햄버거 제거) — 해소됨**
   - WF-08 모바일 6장([WF-08-link-mobile-light.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-08-link-mobile-light.png), [WF-08-link-mobile-dark.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-08-link-mobile-dark.png), `state-A` 2장, `state-B` 2장) 모두에서 햄버거 메뉴 버튼이 제거되고 로고(`NaruWorks`)와 `로그인` 버튼만 유지됨. 회원 드로어는 생성되지 않음.

3. **minor (줄바꿈 수정) — 해소됨**
   - WF-05 상태 A(데스크톱·모바일), 상태 B·C·E 모바일 알림, WF-06 모바일 안내·빈 상태·오류, WF-07 A·B 오류(데스크톱·모바일) 및 모바일 도움말, WF-08 보기 영역·상태 B 차단 안내(데스크톱·모바일)에서 `1GB까지입니다.` 등 음절 단위 중간 끊김이 해소되었고 새로운 단어 중간 끊김은 보이지 않음.

4. **minor (WF-05 상태 B·C·E·D 호버 배경 정리) — 해소됨**
   - WF-05 데스크톱 B·C·D·E 라이트·다크([WF-05-drive-desktop-light-state-B.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-05-drive-desktop-light-state-B.png) 등)에서 `현장 사진 03.jpg` 행에 남아 있던 `surface-hover` 배경이 제거됨.

5. **minor (WF-05·06 모바일 서비스 맥락 표지) — 해소됨**
   - WF-05 모바일(기본·A·B·C·D·E·드로어 배경) 및 WF-06 모바일(기본·A·B·드로어 배경) 헤더 아래 첫 줄에 소형 아치 메달리온 + 「나루 드라이브」 서비스 표지가 추가됨.

6. **minor (WF-06 상태 B 파일·상태·버튼 일치) — 해소됨**
   - 데스크톱·모바일 × 라이트·다크 4장([WF-06-trash-desktop-light-state-B.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-06-trash-desktop-light-state-B.png), [WF-06-trash-desktop-dark-state-B.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-06-trash-desktop-dark-state-B.png), [WF-06-trash-mobile-light-state-B.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-06-trash-mobile-light-state-B.png), [WF-06-trash-mobile-dark-state-B.png](../../../docs/03-ui-design/screens/exports/wf05-08/WF-06-trash-mobile-dark-state-B.png)) 모두에서 오류 대상·선택 행이 `견적서 v1.pdf`로 일치하고, 남은 기간은 `30일 경과`, 「원래 위치로 복원」 버튼은 비활성 스타일(`surface` 바탕, `border` 테두리, `text-muted` 글자)로 표시됨.

---

### 4. 새 회귀

- **없음.**
  - 텍스트 잘림, 토큰 오용, 패리티 붕괴, 필수 요소 누락, 메달리온·알림 원칙 위반, 테마 선택기 배치(DEC-101 미배치 유지), Deep Ink 브랜드 이탈 등 새 회귀가 관찰되지 않았으며 `exports/wf05-08/` PNG 커버리지 **66장**이 유지됨.

---

### 5. 경미 4 기록

- WF-08 데스크톱 헤더 로그인 버튼 왼쪽의 `[문구 미확정]` 표기가 모바일 헤더에는 없고 [screens.md](../../../docs/03-ui-design/screens/screens.md#L571)에도 생략 사유가 없는 상태가 그대로 유지됨(수정 보류 지시에 따름).

---

### 6. 검토하지 못한 부분과 이유

- **미확인 일부 PNG 및 FigCraft 내부 노드 `[미확인]`:** 66장 중 수정 사항과 직결된 주요 프레임과 라이트/다크·모바일 짝을 육안으로 확인했으나, 동일 구조의 일부 다크·모바일 복제본(`WF-05-drive-desktop-dark-state-A.png`, `WF-05-drive-mobile-dark-state-C/E.png`, `WF-07-member-share-desktop-dark*.png` 등)과 [screens-wf05-08.figcraft](../../../docs/03-ui-design/screens/screens-wf05-08.figcraft) 내부 전체 노드는 개별로 열지 않음.
- **실구현 폰트·대비 실측·동작 `[미확인]`:** 실제 글꼴(IBM Plex Sans KR) 적용 시의 줄바꿈, 화면 단위 명도 대비 실측(DEC-102), 키보드·스크린리더 읽기 순서 및 인터랙션은 정적 PNG 검토 범위 밖이라 확인하지 못함.
