# Deep Ink 커스텀 아이콘 세트(v0.3, DES-004) 독립 재검토

## 1. 요약

- **판정**: **경미**
- **심각도별 개수**: `blocking` **0건** / `major` **0건** / `minor` **3건**
- **종합 의견**: 필수 37개 아이콘의 SVG·FigCraft 컴포넌트·문서·라이트/다크 PNG가 모두 일치하며, Lucide/ISC 잔여 제안이나 패스 복사 흔적 없이 Deep Ink 아치 곡선 언어에 맞춘 원본 세트로 구현되어 있습니다.

---

## 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
| --- | --- | --- | --- | --- | --- |
| 1 | `minor` | [file-pdf.svg](icons/file-pdf.svg), [icons-light.png](exports/icons-light.png) | `file-pdf` 단독 시각 식별성 약함 | 내부 곡선(`M8 16.7C10.35 16.7 ... 16.05 16.7`)이 단일 리본/파형으로 보여 16px에서 단독으로 PDF임을 직관적으로 읽기 약함([design-system.md](design-system.md#L112)의 `'PDF'` 레이블 병기 규칙으로 완화됨) | 현행 레이블 병기 규칙을 유지하거나, 추후 개선 시 루프/문서 표식 대비를 더 명확히 다듬는 것을 고려 |
| 2 | `minor` | [file-archive.svg](icons/file-archive.svg), [icons-light.png](exports/icons-light.png) | `file-archive` 16px 내부 밀집 | 좁은 페이지 실루엣 안에 지퍼 눈금 3개와 하단 상자가 함께 들어가 16px에서 내부 디테일이 다소 촘촘함(다른 파일 유형과 구분은 가능) | 지퍼 눈금 간격을 소폭 넓히거나 눈금 수를 줄여 16px 여백 확보 고려 |
| 3 | `minor` | [components-navigation-light.png](exports/components-navigation-light.png), [components-shell-light.png](exports/components-shell-light.png) | `components-*.png` 내보내기는 v0.2 상태 유지 | [design-system.figcraft](design-system.figcraft) 내부의 `icon/admin` 컴포넌트와 인스턴스에는 아치+수면선이 반영되어 있으나, `components-*.png` 이미지에는 v0.2 빈 방패 아이콘이 남아 있음([design-system.md](design-system.md#L377)은 `icons-light/dark.png`만 갱신했다고 명시) | 필요 시 `components-*.png`도 v0.3 기준으로 재내보내기하여 산출물 간 시각 일치 |

---

## 3. 37개 커버리지 결과

- **SVG 파일(`docs/03-ui-design/design-system/icons/*.svg`)**: **37개 전원 존재** (빠진 이름: 없음 / 추가 이름: 없음)
- **문서([design-system.md](design-system.md#L114-L152))**: 37개 이름·용도 일치, v0.3 표기 및 `project-owned` 라이선스·규격(`24×24`, 패딩 `2px`, 스트로크 `1.75px`, 라운드 캡/조인, `currentColor`) 반영 완료. Lucide 링크·ISC 라이선스 전문·구 제안명 열 없음(v0.3 변경 이력에 철회 사실만 기술).
- **미리보기·FigCraft**: [icons-light.png](exports/icons-light.png) 및 [icons-dark.png](exports/icons-dark.png) 양쪽 모두 동일한 37개 세트가 16·20·24px로 렌더링되어 있으며, [design-system.figcraft](design-system.figcraft) 내 `Icons` 페이지(`Icons · Light`, `Icons · Dark`), `icon/<name>` 컴포넌트 37종(빠짐/추가 0건), 문서 전체 인스턴스 575개 확인.
- **WF 커버리지**: [WF-02.png](../../01-planning/wireframe/exports/WF-02.png), [WF-05.png](../../01-planning/wireframe/exports/WF-05.png), [WF-06.png](../../01-planning/wireframe/exports/WF-06.png), [WF-12.png](../../01-planning/wireframe/exports/WF-12.png) 기준 홈·드라이브·폴더·파일 유형·올리기/내려받기·공유·링크·휴지통·복원·더 보기·회원·관리·로그아웃·닫기·확인·주의·정보·셰브론·메뉴·진행 등 주요 용도가 37개 세트로 커버됨.

---

## 4. SVG 기술 요건 요약

- **XML 파싱**: 37개 파일 모두 정상 파싱 (실패 파일 없음)
- **`viewBox`**: 37개 모두 `viewBox="0 0 24 24"`
- **색상/스트로크**: 37개 모두 `fill="none"`, `stroke="currentColor"`, `stroke-width="1.75"`, `stroke-linecap="round"`, `stroke-linejoin="round"` (하드코딩된 색상 없음)
- **패딩(2px 라이브 에어리어)**: 전체 패스 좌표 범위가 `x ∈ [2.05, 21.95]`, `y ∈ [2.25, 21.75]`로 `24×24` 내 2px 패딩 영역(`[2, 22]`) 안에 위치함

---

## 5. 16px 가독성 · 유사 아이콘 구분 요약

- **16px 가독성**: `close`, `check`, `chevron-down`, `chevron-right`, `search`, `loader`, `restore`, `settings`, `language` 모두 16px에서 형태가 뭉개지지 않고 읽힘. `more`는 3개 점(`0.45px` 라운드 캡)으로 시각 무게가 다소 가볍고, `file-archive`와 `file-pdf`는 상기 `minor` 참고 사항이 있음.
- **조형 일관성**: 모든 파일 유형 7종(`file`, `file-text`, `file-image`, `file-pdf`, `file-video`, `file-audio`, `file-archive`)이 동일한 페이지 실루엣(`4.75..19.25`, `3..21`)과 접힌 모서리를 공유하며, [symbol.svg](assets/symbol.svg)의 부드러운 아치 언어(`home`, `admin`, `user`, `Q` 곡선 코너)가 일관되게 반영됨.
- **유사 아이콘 구분**:
  - `share`(3노드 분기) vs `link`(사선 체인 고리): 명확히 구분됨
  - `restore`: 하단 노치 트레이 + 우상향 복귀 화살표로 단순 undo가 아닌 복원으로 읽힘
  - `view-list`(불릿+가로선) vs `sort`(상하 양방향 화살표): 명확히 구분됨
  - `more`(가로 점 3개) vs `menu`(가로 막대 3개): 명확히 구분됨
  - `upload` vs `download`: 트레이 위 상향/하향 화살표로 명확히 구분됨
  - `user`(원+어깨 아치) vs `admin`(방패+Deep Ink 아치/수면선): 명확히 구분됨
  - `theme-light`(해) / `theme-dark`(초승달) / `theme-system`(모니터): 명확히 구분됨

---

## 6. 원본성 관찰

- **복사 의심 아이콘**: **없음**
- **근거**: 37개 SVG 모두 `<rect>`/`<circle>`/`<line>` 기본 도형 조합이 아니라 소수점 좌표와 `Q`/`C` 베지어 곡선을 포함한 단일 `<path>`로 직접 작성되었으며, `home`(아치 지붕·출입구), `admin`(방패 내부 아치+수면선), `settings`(타원형 슬라이더 노브), `restore`(노치 트레이+곡선 화살표), `drive`(사다리꼴+슬롯) 등에서 Deep Ink 고유 조형이 확인됨.

---

## 7. 검토하지 못한 부분과 그 이유

- **FigCraft 데스크톱 앱을 통한 라이브 렌더링**: [design-system.figcraft](design-system.figcraft)는 ZIP 내부 `document.json`을 직접 읽어 페이지·컴포넌트·인스턴스·벡터 정점 존재 여부를 검증했으나, FigCraft 앱으로 직접 열어 화면을 실시간 렌더링하지는 못함(`[미확인]`, 대신 `icons-light.png`·`icons-dark.png`로 렌더링 결과 교차 확인).
- **WF-01~16 전수 열람**: `WF-02`, `WF-05`, `WF-06`, `WF-12` 이미지를 직접 확인해 핵심 용도 커버리지를 대조했으며, 나머지 WF 화면(`WF-01`, `03`, `04`, `07`~`11`, `13`~`16`)의 개별 이미지·주석은 전수 열람하지 않음(`[미확인]`).
