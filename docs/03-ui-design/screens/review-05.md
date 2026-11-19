<!-- naru-orch job=P3-4-screens-wf01-04-review-05 provider=antigravity model=gemini-4-hydrogen-medium agent=d65f4dfa-f1a7-49c0-89b6-09da9cd79d58 saved=2026-11-19T18:13:53+09:00 -->

> **시도 기록.** 이 파일은 attempt 2(17:44:43–17:51:11 KST, agent `d65f4dfa-f1a7-49c0-89b6-09da9cd79d58`)의 최종 답이다. 판정은 경미, blocking 0 / major 0 / minor 5. attempt 1(17:33:12–17:41:18 KST, agent `7b826265-dc19-4145-9425-8876e88c1f4b`)은 검토문을 거의 완성한 뒤 `agent status error`(Google API `connection reset by peer`)로 failed가 되었다. 회수본은 `~/.naru-orch/jobs/P3-4-screens-wf01-04-review-05/recovered-review.md`에 있으며, 당시 판정은 경미, blocking 0 / major 0 / minor 3이었다. attempt 2는 그 3건(모바일 힌트 생략, WF-04 상태 B/S 버튼 위계, screens.md v2 PNG 표 부재)을 유지하고, 오류 아이콘 색(`text`가 아닌 `error` 토큰)과 모바일 헤더 드로어 프레임 부재를 minor로 추가했다.

## 1. 요약

- **판정**: **경미** (v1 반려 사유였던 데스크톱 왼쪽 쏠림 및 빈 공간 문제는 v2에서 완전히 해결되었으며, 브랜드 A·토큰·다크·모바일·대비·기능 커버리지 기준을 충족함)
- **심각도별 개수**: `blocking` **0건** / `major` **0건** / `minor` **5건**

---

## 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
| --- | --- | --- | --- | --- | --- |
| 1 | `minor` | WF-02 모바일 카드 (`v2/card-litpage-mobile`, `v2/card-drive-mobile`), [screens.md](../../../docs/03-ui-design/screens/screens.md#L130) | 데스크톱 카드 하단에 있는 보조 메타 문구(`처음 열 때 저장 폴더를 선택합니다`, `파일당 1GB 이하 업로드`)가 모바일 카드에서는 생략되어 있으며, `screens.md` v2에 생략 사유가 적혀 있지 않음 | [WF-02-home-desktop-light.png](../../../docs/03-ui-design/screens/exports/v2/WF-02-home-desktop-light.png) vs [WF-02-home-mobile-light.png](../../../docs/03-ui-design/screens/exports/v2/WF-02-home-mobile-light.png) | 모바일 카드에 1줄 메타를 추가하거나, 모바일 정보 밀도를 위해 의도적으로 생략했음을 `screens.md` v2에 명시 |
| 2 | `minor` | WF-04 상태 B vs 상태 S ([desktop-light-state-B](../../../docs/03-ui-design/screens/exports/v2/WF-04-litpage-desktop-light-state-B.png), [desktop-light-state-S](../../../docs/03-ui-design/screens/exports/v2/WF-04-litpage-desktop-light-state-S.png)) | 동일한 "작업 영역 진입 불가 안내 + 홈으로 돌아가기" 패턴인데, 상태 B는 `primary` 버튼, 상태 S는 `secondary` 버튼을 사용해 버튼 위계가 다름 | PNG 8장(B/S 데스크톱·모바일 × 라이트·다크) 직접 대조 | 두 상태 모두 동일 위계(`primary` 또는 `secondary`)로 통일(권장: `primary`) |
| 3 | `minor` | WF-01 상태 A·S, WF-04 상태 A·B·S 오류/경고 아이콘 | 오류 알림(`Inline alert`) 및 차단 패널의 경고 아이콘 색상이 `error`(`#B42318`/`#F2766B`)가 아닌 `text`(`#0F1B2D`/`#E8EDF5`)로 적용됨 (`screens.md` 158행에 자진 기재됨) | [design-system.md](../../../docs/03-ui-design/design-system/design-system.md#L259) 대비표(`error / error-subtle` 용도: 안내 아이콘) 및 [screens.md](../../../docs/03-ui-design/screens/screens.md#L158) | 추후 인스턴스 아이콘 색상을 `error` 토큰으로 맞추면 상태 인지가 더 명확해짐(대비 5.70:1 / 4.88:1로 AA 통과) |
| 4 | `minor` | 모바일 헤더 드로어 (WF-02~04 모바일) | `screens.md` v2 141행에 명시된 대로 모바일 드로어 열린 상태 프레임이 이번 v2 묶음에 포함되지 않아, 상태 B(오픈소스 숨김) 시 드로어 내 항목 정리는 DS [components-shell-light.png](../../../docs/03-ui-design/design-system/exports/components-shell-light.png)에만 의존함 | [screens.md](../../../docs/03-ui-design/screens/screens.md#L141) | 필요 시 v2 화면 부품 페이지에 일반 회원 드로어(기본/숨김) 참조 프레임 1~2개 추가 검토 |
| 5 | `minor` | [screens.md](../../../docs/03-ui-design/screens/screens.md#L115-L133) v2 절 | v1 절과 달리 v2 절에는 56개 PNG 파일명별 개별 링크 표가 없고 명명 규칙(`WF-xx-…`)으로만 요약되어 있음 | [screens.md](../../../docs/03-ui-design/screens/screens.md#L119) | v2 절에도 v1과 동일한 56개 PNG 매핑 표를 두면 추적성이 높아짐 |

---

## 3. 56개 커버리지 결과

- **`exports/v2/` 파일 수**: **56개 모두 존재** (`.keep` 플레이스홀더 1개 제외, 누락·불필요 추가 PNG 없음).
  - WF-01 로그인: 12개 (`기본`, `state-A`, `state-S` × `desktop/mobile` × `light/dark`)
  - WF-02 홈: 20개 (`기본`, `state-A`, `state-B`, `state-C`, `state-D` × `desktop/mobile` × `light/dark`)
  - WF-03 저장 폴더 선택: 8개 (`기본`, `state-A` × `desktop/mobile` × `light/dark`)
  - WF-04 Litpage: 16개 (`기본`, `state-A`, `state-B`, `state-S` × `desktop/mobile` × `light/dark`)
- **`screens-wf01-04-v2.figcraft` 일치 여부**: 4개 화면 페이지(`WF-01 · 로그인 v2`, `WF-02 · 서비스 목록 홈 v2`, `WF-03 · 저장 폴더 선택 v2`, `WF-04 · Litpage v2`) 내 아트보드(프레임) 56개 이름이 `exports/v2/` PNG 파일명과 1:1 일치함. `screens.md` v2의 화면/상태 목록과도 일치함.

---

## 4. WF·AC 정합성 요약

[screen-data-actions.md](../../../docs/03-ui-design/screen-data/screen-data-actions.md) 및 [WF-01.png](../../../docs/01-planning/wireframe/exports/WF-01.png)~[WF-04.png](../../../docs/01-planning/wireframe/exports/WF-04.png) 대조 결과, 모든 필수 기능·상태가 누락 없이 반영되었으며 와이어프레임 대비 변경 사유가 [screens.md](../../../docs/03-ui-design/screens/screens.md#L127-L133) v2에 기록되어 있음.

- **WF-01 로그인**: 공통 헤더 없음, 공통 푸터 있음. Google 로그인 단일 버튼(`Google로 로그인`), 상태 A(인증 취소·실패 인라인 알림 + 같은 버튼 재시도) 반영. 30일 안 재가입 복구 안내는 WF-01에 두지 않음(WF-02 상태 C).
- **WF-02 서비스 목록 홈**: 문서=`Litpage`, 저장소=`나루 드라이브`. 상태 A(빈 카테고리 점선 상태), B(모든 오픈소스 숨김 시 문서 카테고리·헤더 `문서` 항목 제거 및 나루 드라이브만 표시), C(30일 안 재가입 복구 안내 대화상자, `[문구 미확정]` 표기), D(오픈소스 라이선스 고지 같은 창 대화상자, `[문구 미확정]` 표기) 모두 반영.
- **WF-03 저장 폴더 선택**: 첫 진입 기본값 `/litpage` 및 기본 폴더 없음 안내, 목록 선택 → 선택 칸 반영 흐름 반영. 상태 A(변경 재사용 안내: 이후 결과물만 새 폴더에 저장, 기존 결과물 유지) 및 취소·확인 분기 안내 문구(첫 진입 취소→홈, 변경 취소→Litpage) 반영.
- **WF-04 Litpage**: 상단 컨텍스트 바(현재 저장 폴더 `/litpage` + `저장 폴더 변경`)와 외부 작업 영역 플레이스홀더로 구성. Litpage 제품 내부 기능을 추측해 그린 과잉 UI 없음. 상태 A(자동 저장 실패 시 작업 영역을 유지한 채 인라인 알림으로 전환, 이유를 `screens.md` v2에 명시), 상태 B(진입 실패 시 작업 영역 자리에 안내 + 홈 복귀 버튼, 폴더 변경 생략) 반영.
- **공통 헤더(WF-02~04) / 공통 푸터(WF-01~04)**: 일반 회원 헤더(로고, 서비스 전환, 문서/저장소 카테고리, 회원 메뉴 아이콘 — 관리자 메뉴 없음). 푸터(`이용약관`, `개인정보처리방침`, `문의 aslanhobae@gmail.com`, `오픈소스 라이선스 고지`, `Dev. Aslan0` — 회사 정보 없음) 모두 기준과 일치.

---

## 5. 시각적 균형·공간 사용·위계·정렬·미감·사용성 요약

v1의 핵심 결함이었던 "데스크톱 1440px 캔버스 좌측 좁은 열 쏠림과 광대한 죽은 공간"이 v2에서 화면 성격에 맞는 구조로 재설계되어 해소됨.

- **WF-01 로그인** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v2/WF-01-login-desktop-light.png) / [모바일 다크](../../../docs/03-ui-design/screens/exports/v2/WF-01-login-mobile-dark.png))
  - 데스크톱: 좌측 `800px` 브랜드 패널(로고, `accent` 금색 룰, 3중 아치·수면선 모티프)과 우측 `640px` 영역 내 `448px` 로그인 카드의 2분할 구성으로 양쪽 모두 의미 있는 밀도와 균형을 확보함.
  - 모바일: 상단 로고+금색 룰 아래 로그인 카드가 중앙 정렬되어 집중도가 높고, 하단 푸터가 세로 44px 행으로 깔끔히 쌓임.
  - 미감·사용성: 가짜 마케팅 카피나 스톡 사진 없이 차분한 SaaS 로그인 완성도를 갖춤. 오류(상태 A/S)가 카드 내부 버튼 바로 위에 위치해 시선 흐름이 자연스러움.
- **WF-02 서비스 목록 홈** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v2/WF-02-home-desktop-light.png) / [모바일 다크](../../../docs/03-ui-design/screens/exports/v2/WF-02-home-mobile-dark.png))
  - 데스크톱: `1200px` 최대폭 가운데 정렬, `588px` 2열 그리드(`문서` / `저장소`)로 1440 캔버스를 균형 있게 사용. 상태 B에서는 `588px` 단일 카드를 중앙 배치해 한쪽으로 쏠리지 않음.
  - 모바일: 1열 가로형 카드(`328x124px`)로 변환되어 스크롤 부담 없이 한눈에 들어오며 다크 모드에서도 카드 경계·아이콘 타일·화살표 구분이 명확함.
  - 위계·사용성: 금색(`accent`) 세로 바 + 카테고리명, 카드 내 아이콘 타일·종류 배지·제목·설명·`열기 >`의 시각적 위계가 뚜렷함. 상태 C/D 모달은 `scrim` 차폐 위 중앙에 안정적으로 배치됨.
- **WF-03 저장 폴더 선택** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v2/WF-03-save-folder-desktop-light.png) / [모바일 다크](../../../docs/03-ui-design/screens/exports/v2/WF-03-save-folder-mobile-dark.png))
  - 데스크톱: `960px` 가운데 정렬 카드 안에 2패널(좌: 선택한 저장 폴더 + 기본값 배지 + 변경 안내, 우: 나루 드라이브 폴더 목록) + 하단 동작 바(경로 안내 + 취소/확인)로 구성해 설정 화면 수준의 밀도와 정렬을 구현함.
  - 모바일: `360x1080` 프레임에서 상단 선택 영역→안내→폴더 목록→동작 바가 세로로 자연스럽게 흐르며, 취소/확인 버튼이 2열로 넉넉한 터치 영역을 확보함. 다크 모드에서 선택된 `/litpage` 행의 `primary` 테두리(`#8DB4F5`)와 체크 아이콘이 선명함.
- **WF-04 Litpage** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v2/WF-04-litpage-desktop-light.png) / [모바일 다크](../../../docs/03-ui-design/screens/exports/v2/WF-04-litpage-mobile-dark.png))
  - 데스크톱: 상단 컨텍스트 바(`1376px`, 좌우 32px 여백)와 전폭 점선 작업 영역(`1376x674px`)으로 외부 앱 호스팅 셸의 역할을 명확히 드러냄.
  - 모바일: 컨텍스트 바가 제목/배지 → 저장 폴더 경로 → `저장 폴더 변경` 전폭 버튼 순으로 세로 재배치되어 360px 폭에서도 겹침·잘림이 없음. 다크 모드에서 상태 A 오류 배너, 상태 B/S 중앙 차단 패널 모두 가독성이 높음.

---

## 6. 토큰·다크·모바일·대비 요약

- **토큰·브랜드 사용**: `screens-wf01-04-v2.figcraft`의 v2 페이지 5개(`WF-01~04 v2` 및 `v2 · 화면 부품`) 전수 검사 결과 **미바인딩(하드코딩) 단색 0건**, `secondary`/`accent`를 텍스트에 사용한 사례 **0건**. Deep Ink 31개 토큰과 커스텀 아이콘(24px 고정)만 사용했으며 Lucide·Grove Mint·NA 로고 흔적 없음. 새 토큰 추가 없음(제안 컴포넌트 5종은 시안 파일 내 `v2 · 화면 부품` 페이지에만 격리).
- **다크 모드 패리티**: 모든 28개 다크 프레임이 `Deep Ink` 컬렉션의 `Dark` 모드(`var_modes`)로 전환되어 라이트 색 잔류 없음. `surface`(`#141D2E`), `surface-raised`(`#1C283C`), `scrim`(`#000000B3`), `primary`(`#8DB4F5`)가 일관되게 적용됨.
- **모바일(360px) 준수**: 잘림·겹침 없음. 주요 터치 영역 검증 결과 `menu-button` `44×44px`, `v2/footer-mobile` 링크 행 높이 `44px`, `v2/folder-row` 높이 `48px`, `v2/card-*-mobile` 높이 `124px`로 모두 44px 이상 충족. (모바일 드로어 열린 프레임은 이번 묶음 범위 밖이며, 실제 탭 동작은 [미확인]).
- **WCAG AA 대비 (반올림 전 계산, [tokens.json](../../../docs/03-ui-design/design-system/tokens.json) 기준)**: 주요 쌍 모두 라이트/다크 기준 통과(실패 쌍 없음).
  - `text` / `surface`: 라이트 `15.9751:1` / 다크 `14.3487:1` (기준 4.5:1 통과)
  - `text` / `surface-raised`: 라이트 `17.2843:1` / 다크 `12.5963:1` (통과)
  - `text-muted` / `surface-raised`: 라이트 `7.4411:1` / 다크 `6.0717:1` (통과)
  - `on-primary` / `primary`: 라이트 `11.5026:1` / 다크 `8.8975:1` (통과)
  - `primary` / `surface-raised`: 라이트 `11.5026:1` / 다크 `7.0371:1` (통과)
  - `error` / `error-subtle`: 라이트 `5.6974:1` / 다크 `4.8848:1` (통과)
  - `text` / `error-subtle`: 라이트 `14.9789:1` / 다크 `11.5130:1` (통과)
  - `text` / `info-subtle`: 라이트 `15.3168:1` / 다크 `11.4591:1` (통과)
  - `border-strong` / `surface-raised`: 라이트 `3.9067:1` / 다크 `4.0455:1` (기준 3.0:1 통과)

---

## 7. 미커밋 기획 메모 처리 결과

- **상태 S (WF-01, WF-04)**: 두 화면 PNG 내부(`시안 추가 · pending planning · 공식 v1.0 동선은 WF-10`, `차단 뒤 도착 화면(WF-02·WF-10) [미확인]`)와 [screens.md](../../../docs/03-ui-design/screens/screens.md#L129-L132) v2 표에 공식 v1.0과의 차이가 숨김 없이 명시되어 있음.
- **DEC-101 (테마 선택기)**: 어떤 화면(WF-01~04)에도 테마 선택기를 확정 배치하지 않았으며, 라이트/다크 프레임은 디자이너 비교용 시안임과 Q-090 미정 상태가 문서에 명시됨.
- **GAP-017 (모바일 썸네일 미리보기)**: [screens.md](../../../docs/03-ui-design/screens/screens.md#L14) 공통 화면 규칙에 "해당 없음. WF-01~04 모바일의 대상 썸네일 미리보기는 없다"고 명시됨.

---

## 8. 아이콘 회귀 확인

- [file-pdf.svg](../../../docs/03-ui-design/design-system/icons/file-pdf.svg): 24×24 viewBox, `1.75px` 스트로크, 접힌 모서리와 `PDF` 글자 획이 유지됨.
- [file-archive.svg](../../../docs/03-ui-design/design-system/icons/file-archive.svg): 24×24 viewBox, `1.75px` 스트로크, 지퍼 눈금 2개 및 당김 손잡이 간격 유지됨.
- [icons-light.png](../../../docs/03-ui-design/design-system/exports/icons-light.png), [icons-dark.png](../../../docs/03-ui-design/design-system/exports/icons-dark.png) 및 [components-data-light.png](../../../docs/03-ui-design/design-system/exports/components-data-light.png), [components-data-dark.png](../../../docs/03-ui-design/design-system/exports/components-data-dark.png) 확인 결과 review-04 이후 회귀 없음.

---

## 9. 검토하지 못한 부분과 그 이유

- **실제 폰트(IBM Plex Sans KR / IBM Plex Sans) 렌더링**: 헤드리스 환경 미설치로 PNG가 대체 글꼴로 렌더링되어 자간·행간 실물 타이포그래피의 미세한 인상은 `[미확인]`.
- **인터랙션·키보드 포커스·스크린리더 읽기 순서·모바일 드로어 동작**: 정적 PNG와 FigCraft JSON 구조만 검토했으며 실제 브라우저 실행 환경이 아니므로 `[미확인]`.
- **호버·포커스·눌림 상태 프레임 및 로딩 상태**: 이번 v2 56장 범위 외이므로 `[미확인]`.
- **Git 커밋(`4b66d1d`, `04bc090`)과의 엄밀한 Git diff 대조**: 읽기 전용 규칙상 git 명령 실행을 금지하여 로컬 파일 기준으로만 확인함(`[미확인]`).
