<!-- naru-orch job=P3-4-screens-wf01-04-review-07 provider=antigravity model=gemini-4-hydrogen-medium agent=1261f8fb-c985-49d7-8fc8-5385c7ec4308 saved=2026-11-19T20:39:57+09:00 -->

## 1. 요약

- **판정**: **수정 필요** (`blocking` **0건** / `major` **2건** / `minor` **4건**)
- **v2·v3 대비 한 줄**: WF-01(아치 입구+수면선)·WF-02(카테고리 선반)·WF-03(목적지 확인대+보조 패널)은 v2·v3의 레이아웃을 답습하지 않고 구성부터 새로 설계해 브랜드 정체성과 현대적 SaaS 완성도가 크게 높아졌으나(WF-04는 v2 골격 정제), WF-03 필수 안내 문구 누락과 `screens.md` v4 구성 근거-화면 간 모순이 남아 있다.

---

## 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
| --- | --- | --- | --- | --- | --- |
| 1 | `major` | WF-03 기본·상태 A ([desktop-light](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-desktop-light.png), [mobile-dark-state-A](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-mobile-dark-state-A.png)) | [screen-data-actions.md](../../../docs/03-ui-design/screen-data/screen-data-actions.md#L149)의 WF-03 표시 데이터인 **「기본 폴더 없음 안내: 기본 폴더가 없으면 만들어 쓸 수 있다」**가 v4 화면에서 누락됨(v2에는 포함) | [WF-03-folder-desktop-light.png](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-desktop-light.png) vs [v2 WF-03](../../../docs/03-ui-design/screens/exports/v2/WF-03-save-folder-desktop-light.png) | WF-03 선택 카드 하단 또는 오른쪽 보조 패널에 기본 폴더 없음 안내 문구를 복구 |
| 2 | `major` | [screens.md](../../../docs/03-ui-design/screens/screens.md#L257), [screens.md](../../../docs/03-ui-design/screens/screens.md#L284) vs v4 PNG | ① 공통 구성 원리(257행)에 아치 메달리온을 "홈 외 나머지 화면에서는 쓰지 않는다"고 적었으나 실제로는 WF-03 보조 패널과 WF-04 작업 영역·차단 카드에도 사용됨(351행과도 모순). ② WF-03 구성 근거(284행)에 상태 A 알림이 "경로 띠 위에 추가된다"고 적었으나 실제로는 데스크톱 우측 보조 패널 상단·모바일 하단 버튼 아래에 배치됨 | [WF-03-folder-desktop-light-state-A.png](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-desktop-light-state-A.png), [WF-04-litpage-desktop-light.png](../../../docs/03-ui-design/screens/exports/v4/WF-04-litpage-desktop-light.png) | `screens.md` 257행의 사용 범위 제한 문구를 실제 적용 범위와 일치시키고, WF-03 상태 A 알림 위치를 데스크톱·모바일·문서 간 통일 |
| 3 | `minor` | WF-04 기본 ([v4](../../../docs/03-ui-design/screens/exports/v4/WF-04-litpage-desktop-light.png) vs [v2](../../../docs/03-ui-design/screens/exports/v2/WF-04-litpage-desktop-light.png)) | WF-01~03과 달리 WF-04는 상단 도구 띠(좌: Litpage+배지, 우: 저장 폴더+변경 버튼)와 하단 전폭 점선 작업 영역 플레이스홀더라는 v2 골격을 대부분 유지하고 폭(1120)·칩·아치 메달리온만 정제함 | 두 PNG 직접 대조 | `screens.md` v4에 WF-04는 기존 도구 띠+작업 영역 구조를 정제한 것임을 명시 |
| 4 | `minor` | WF-03 데스크톱 vs 모바일 버튼 순서 | 데스크톱([WF-03](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-desktop-light.png))은 `[취소] [확인]`, 모바일([WF-03 모바일](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-mobile-dark-state-A.png))은 위 `[확인]` / 아래 `[취소]` 순서로 배치되었으나 문서 설명이 없음 | 두 PNG 대조 및 [screens.md](../../../docs/03-ui-design/screens/screens.md#L284-L285) | 모바일 세로 스택 시 primary 우선 배치 원칙을 `screens.md`에 기록 |
| 5 | `minor` | 다크 모드 카드 그림자 ([screens-wf01-04-v4.figcraft](../../../docs/03-ui-design/screens/screens-wf01-04-v4.figcraft)) | `effects`의 dropShadow 색상이 라이트 `#0F1B2D`(alpha 0.10 / 0.20) 고정값으로 변수 미바인딩 상태([screens.md](../../../docs/03-ui-design/screens/screens.md#L388)에 자진 기재됨) | FigCraft JSON `effects` 전수 검사 | 다크 프레임에서는 그림자를 제거하거나 다크 전용 그림자 값 적용 검토 |
| 6 | `minor` | WF-01 상태 S ([desktop-light-state-S](../../../docs/03-ui-design/screens/exports/v4/WF-01-login-desktop-light-state-S.png)) | `screens.md` 312·341행에는 공식 v1.0 동선(WF-10)과의 차이가 명시되어 있으나, PNG 화면 내부에는 `[문구 미확정]`만 있고 WF-10 주석이 없음 | [WF-01-login-desktop-light-state-S.png](../../../docs/03-ui-design/screens/exports/v4/WF-01-login-desktop-light-state-S.png) | 시안 핸드오프 시 `screens.md`의 WF-10 차이를 함께 전달하도록 유지 |

---

## 3. 커버리지 결과

- **`exports/v4/` PNG 파일 수**: **64개 모두 존재** (기본·상태 56장 + 모바일 드로어 8장, 누락·초과 0건).
  - WF-01: 12장 (`기본`, `state-A`, `state-S` × `desktop/mobile` × `light/dark`)
  - WF-02: 20장 + 드로어 4장 (`기본`, `state-A`, `state-B`, `state-C`, `state-D` + `drawer`, `state-B-drawer`)
  - WF-03: 8장 + 드로어 2장 (`WF-03-folder-…` 명명 규칙 준수)
  - WF-04: 16장 + 드로어 2장
- **3자 일치 여부**: [screens-wf01-04-v4.figcraft](../../../docs/03-ui-design/screens/screens-wf01-04-v4.figcraft)의 `WF-*` 프레임 64개, `exports/v4/` PNG 64개, [screens.md](../../../docs/03-ui-design/screens/screens.md#L356-L382) PNG 링크 표 64개(고유 링크 64개)가 1:1 일치함.

---

## 4. WF·AC 정합성

[screen-data-actions.md](../../../docs/03-ui-design/screen-data/screen-data-actions.md) 대조 결과:
- **WF-01 로그인**: 공통 헤더 없음, 공통 푸터 있음, `Google로 로그인` 단일 버튼 및 상태 A(인증 취소·실패 인라인 알림 + 같은 버튼 재시도) 충족.
- **WF-02 홈**: 문서=`Litpage`, 저장소=`나루 드라이브`. 상태 A(빈 카테고리 점선), B(오픈소스 숨김 시 헤더·본문에서 `문서` 제거), C(30일 안 재가입 복구 안내 모달, `[문구 미확정]`), D(라이선스 고지 모달, `[문구 미확정]`) 모두 반영.
- **WF-03 저장 폴더 선택**: 기본값 `/litpage`와 폴더 목록, 상태 A(변경 재사용 안내: 이후 결과물만 새 폴더, 기존 유지), 취소·확인 분기 안내 반영. 단 **기본 폴더 없음 안내 문구만 누락**(발견 #1).
- **WF-04 Litpage**: 전폭 도구 띠(저장 폴더 칩 + `저장 폴더 변경`)와 라벨 있는 플레이스홀더 작업 영역으로 구성되며 과잉 Litpage 내부 UI 없음. 상태 A(자동 저장 실패 인라인 알림 + 작업 유지), B(진입 실패 차단 카드 + `홈으로 돌아가기`) 충족.
- **공통 헤더(WF-02~04)·푸터(WF-01~04)**: 일반 회원 헤더(로고, 서비스 전환, 문서/저장소 카테고리, 회원 메뉴 — 관리자 항목 없음)와 푸터(`이용약관`, `개인정보처리방침`, `오픈소스 라이선스 고지`, `문의 aslanhobae@gmail.com`, `Dev. Aslan0`, 회사 정보 없음) 모두 일치.

---

## 5. minor 5건 반영 결과

| # | 항목 | 결과 | 근거 |
| --- | --- | --- | --- |
| 1 | WF-02 모바일 카드 보조 힌트 | **반영 완료** | [WF-02-home-mobile-dark.png](../../../docs/03-ui-design/screens/exports/v4/WF-02-home-mobile-dark.png)에 `처음 열 때 저장 폴더를 선택합니다`, `파일당 1GB 이하 업로드`가 1줄로 표시됨 |
| 2 | WF-04 상태 B·S 「홈으로 돌아가기」 위계 | **반영 완료** | [state-B](../../../docs/03-ui-design/screens/exports/v4/WF-04-litpage-desktop-light-state-B.png)와 [state-S](../../../docs/03-ui-design/screens/exports/v4/WF-04-litpage-desktop-light-state-S.png) 모두 `primary` 버튼으로 통일 |
| 3 | 오류·경고 아이콘 `error` 색 적용 | **반영 완료** | FigCraft 전수 검사 및 PNG 확인 결과 WF-01 A·S, WF-04 A·B·S의 `ic-warning` 벡터가 모두 `error`(`#B42318`/`#F2766B`)에 바인딩됨 |
| 4 | 모바일 드로어 8장 | **반영 완료** | 일반 회원(프로필·로그아웃만), 닫기(`ic-close`), 상태 B 드로어에서 `Litpage`·`문서` 제거, 테마 선택기 미배치 모두 확인 |
| 5 | `screens.md` v4 PNG 링크 표 | **반영 완료** | [screens.md](../../../docs/03-ui-design/screens/screens.md#L356-L382)에 64장 링크 표 수록 |

---

## 6. 구성 근거·스킬 적용 기록 vs 화면

- **일치하는 부분**:
  - **WF-01 아치 입구 + 전폭 수면선 3줄(금색 1줄)**: PNG에서 중앙 아치 카드와 뒤쪽 전폭 수면선이 명확히 구현됨.
  - **WF-02 카테고리 선반**: 좌측 카테고리 제목+개수, 우측 전폭 서비스 카드(아치 메달리온 포함) 구조가 화면과 일치함.
  - **한 화면 한 primary, 카드 안 카드 금지, 장식 상태점 제거**: v2의 카테고리 옆 금색 세로 바를 제거하고(hallmark 규칙), 버튼 위계를 정리함.
- **불일치(발견 #2)**:
  - `screens.md` 257행은 아치 메달리온을 홈 외 나머지 화면에서 쓰지 않는다고 했으나 WF-03·WF-04에도 사용됨.
  - `screens.md` 284행은 WF-03 상태 A 알림을 경로 띠 위에 둔다고 했으나 실제 화면은 우측 보조 패널 상단(데스크톱) / 버튼 아래(모바일)에 있음.

---

## 7. 시각적 균형·위계·미감·사용성 (데스크톱 라이트 · 모바일 다크 · v2 비교)

- **WF-01 로그인** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v4/WF-01-login-desktop-light.png) / [모바일 다크](../../../docs/03-ui-design/screens/exports/v4/WF-01-login-mobile-dark.png))
  - v2의 좌우 2분할에서 벗어나 중앙 아치 입구 카드와 전폭 수면선으로 브랜드 모티프("나루")를 강렬하면서도 절제된 SaaS 톤으로 풀어냄. 가짜 사진·마케팅 카피 없이 깔끔하며 v1의 좌측 쏠림 재발 없음.
- **WF-02 서비스 목록 홈** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v4/WF-02-home-desktop-light.png) / [모바일 다크](../../../docs/03-ui-design/screens/exports/v4/WF-02-home-mobile-dark.png))
  - v2의 2열 카드 그리드에서 1120px 카테고리 선반으로 재구성해 데스크톱 캔버스 활용도와 확장성(카테고리 추가 시 행 추가)이 좋아짐. 모바일 다크에서도 아치 메달리온, 배지, 보조 힌트, 전폭 `열기 >` 버튼의 시선 흐름과 터치 영역이 우수함.
- **WF-03 저장 폴더 선택** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-desktop-light.png) / [모바일 다크 상태 A](../../../docs/03-ui-design/screens/exports/v4/WF-03-folder-mobile-dark-state-A.png))
  - v2의 단일 카드 내 2패널 구조를 720px 선택 카드 + 우측 Litpage 보조 패널의 1120px 2열로 재구성해 "어디에 저장되는지" 확인성이 높아짐. 모바일 다크에서도 폴더 선택 체크와 상태 A 안내가 선명함.
- **WF-04 Litpage** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/v4/WF-04-litpage-desktop-light.png) / [모바일 다크](../../../docs/03-ui-design/screens/exports/v4/WF-04-litpage-mobile-dark.png))
  - v2와 동일한 상단 도구 띠 + 큰 점선 작업 영역 구조이나, 1120px 정렬과 저장 폴더 칩 분리로 정돈감이 개선됨. 상태 B/S의 중앙 차단 카드는 데스크톱·모바일 모두 위계가 명확함.

---

## 8. 토큰·다크·모바일·대비

- **토큰·브랜드**: `screens-wf01-04-v4.figcraft`의 WF-* 64개 프레임 전수 검사 결과 **미바인딩 단색 0건**, `secondary`/`accent`의 텍스트 사용 **0건**, 새 토큰 추가 없음(Deep Ink 31개 중 17개 토큰 바인딩). 커스텀 아이콘만 사용했으며 Lucide·Grove Mint·NA 로고 없음.
- **다크 모드 패리티**: 32개 다크 프레임 루트에 `var_modes: {'VariableCollectionId:1': 'VariableCollectionId:1/mode2'}`가 적용되었고 내부 라이트 오버라이드 0건(라이트 색 잔존 없음).
- **모바일 360px·터치 44px**: 모든 모바일 프레임에서 360px 초과/음수 x 잘림 **0건**, 인터랙티브 컨테이너(버튼, 폴더 행, 메뉴/닫기 버튼 등) 44px 미만 **0건**.
- **WCAG 2.1 AA 대비** ([tokens.json](../../../docs/03-ui-design/design-system/tokens.json) 기준 직접 계산):
  - `text` / `surface`: 라이트 `15.9751:1`, 다크 `14.3487:1` (통과)
  - `text` / `surface-raised`: 라이트 `17.2843:1`, 다크 `12.5963:1` (통과)
  - `text-muted` / `surface-raised`: 라이트 `7.4411:1`, 다크 `6.0717:1` (통과)
  - `on-primary` / `primary`: 라이트 `11.5026:1`, 다크 `8.8975:1` (통과)
  - `error` / `error-subtle`: 라이트 `5.6974:1`, 다크 `4.8848:1` (통과)
  - `info` / `info-subtle`: 라이트 `5.4075:1`, 다크 `5.5539:1` (통과)
  - `border-strong` / `surface-raised`: 라이트 `3.9067:1`, 다크 `4.0455:1` (UI 경계 3:1 통과)
  - 실패 쌍 없음.

---

## 9. 미커밋 기획 메모

- **상태 S와 WF-10**: [screens.md](../../../docs/03-ui-design/screens/screens.md#L312) 및 [323행](../../../docs/03-ui-design/screens/screens.md#L323), [341행](../../../docs/03-ui-design/screens/screens.md#L341)에 공식 v1.0 동선이 WF-10이며 상태 S가 시안 추가(`pending planning`)임이 숨김 없이 명시됨.
- **DEC-101 테마 선택기**: Q-090 미정 상태로 어떤 프레임(헤더·드로어 포함)에도 확정 배치하지 않았음.
- **GAP-017**: [screens.md](../../../docs/03-ui-design/screens/screens.md#L325)에 이 네 화면에 해당 없음으로 명시됨.

---

## 10. 검토하지 못한 부분과 이유

- **IBM Plex Sans KR 실물 폰트 렌더링**: 헤드리스 FigCraft 환경에 해당 폰트가 없어 대체 글꼴로 렌더링된 PNG만 확인함(`[미확인]`).
- **호버·포커스·눌림·로딩 상태 및 실제 인터랙션(드로어 열림/닫힘, 키보드 포커스 이동, 스크롤)**: 정적 시안 범위 밖이므로 `[미확인]`.
- **64장 PNG 전체 육안 대조**: FigCraft 구조·토큰·좌표는 64개 전수 스크립트 검증했으나, PNG 이미지 직접 육안 확인은 각 화면/상태/드로어 대표 프레임(총 19장) 위주로 수행하고 나머지 변형은 동일 구조·모드 전환으로 확인함(`[미확인]`).
- **공식 기준선(`4b66d1d`)과의 git diff 대조**: 읽기 전용 규칙상 git 명령 실행을 금지하여 로컬 파일(`screen-data-actions.md` 등) 기준으로만 대조함(`[미확인]`).
