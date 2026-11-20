<!-- naru-orch job=P3-4-screens-wf09-12-review-11 provider=antigravity model=gemini-4-hydrogen-medium agent=ed3d6d1a-01f1-49ba-89d4-f0327f60441f saved=2026-11-20T09:32:12+09:00 -->

## 1. 요약

- **판정:** **경미** (시안 승인 가능 수준, 문서 표기·시안 주석 겹침 등 경미한 항목만 존재)
- **심각도별 개수:** `blocking` **0건** / `major` **0건** / `minor` **4건**

v1에서 지적되었던 「데스크톱 내용이 왼쪽 좁은 열에만 몰리고 나머지가 빈 화면」 문제는 **재발하지 않았습니다.** 모든 화면이 1440 데스크톱 캔버스와 1120 가운데 정렬(또는 중앙 축·전폭 수면선) 구성을 안정적으로 사용하며, 브랜드 A(Deep Ink), 커스텀 아이콘(DES-004), v4·WF-05~08 시각 언어, 기획 v1.0(FR/AC·screen-data) 및 DEC-084·101·102를 충실히 따르고 있습니다.

---

## 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
| --- | --- | --- | --- | --- | --- |
| 1 | `minor` | [screens.md](../../../docs/03-ui-design/screens/screens.md#L621), [screens.md](../../../docs/03-ui-design/screens/screens.md#L702), [WF-10-login-blocked-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-10-login-blocked-desktop-light.png) | WF-10 문서 내 토큰 표기 불일치 및 모호함: 621행에는 메달리온을 `warning, error 색`, 전폭 수면선을 `border` 한 줄로 적었으나, 702행에는 `border-strong` 전폭 선으로 적었고 실제 PNG에서는 `warning` 아이콘에 `error` 색·`accent` 짧은 선이 적용됨 | [screens.md](../../../docs/03-ui-design/screens/screens.md#L621) vs [L702](../../../docs/03-ui-design/screens/screens.md#L702) | 621행의 메달리온 설명을 「`warning` 아이콘(`error` 색) + `accent` 선」으로, 전폭 수면선을 실제 사용 토큰(`border-strong`)에 맞춰 통일 |
| 2 | `minor` | [screens.md](../../../docs/03-ui-design/screens/screens.md#L599), [screens-wf09-12.figcraft](../../../docs/03-ui-design/screens/screens-wf09-12.figcraft) | 변수 개수 표기 차이: 599행에는 변수 컬렉션을 `22개`로 적었으나, 실제 FigCraft 컬렉션에는 파일 내부 보조 변수 `wordmark`를 포함해 `23개`가 등록됨(696행에는 별도 설명 존재) | `document.json` 내 `variables.variables` 23개 확인 | 599행에 「DS 22개 + 파일 내부 `wordmark` 1개」로 병기해 696행과 일치시킴 |
| 3 | `minor` | [WF-11-admin-desktop-light-menu-open.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-11-admin-desktop-light-menu-open.png), [WF-11-admin-desktop-dark-menu-open.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-11-admin-desktop-dark-menu-open.png) | 열린 회원 메뉴 드롭다운이 첫 번째 메뉴 행(회원 목록) 오른쪽의 `WF-12` 목적지 주석 칩과 이동 화살표를 가림 | [screens.md](../../../docs/03-ui-design/screens/screens.md#L720)에 제작자도 한계로 기록 | 팝오버의 실제 겹침 동작이며 구현 시 `WF-12` 주석 칩이 제거되므로 현 상태 유지 가능(필요 시 주석 위치만 조정) |
| 4 | `minor` | [screens.md](../../../docs/03-ui-design/screens/screens.md#L719), [WF-10-login-blocked-desktop-dark.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-10-login-blocked-desktop-dark.png) | 다크 모드에서 카드·대화상자·드롭다운 그림자 색상이 변수에 묶이지 않은 고정값이며, WF-10 다크 모드에서는 전폭 수면선이 메달리온 하단 라운드 경계와 맞닿아 시각적 구분이 다소 약함 | [screens.md](../../../docs/03-ui-design/screens/screens.md#L719) 및 PNG 육안 확인 | 구현 단계에서 [design-system.md](../../../docs/03-ui-design/design-system/design-system.md#L77-L81) 다크 그림자 토큰(`#0000004D`~`#00000080`) 적용 |

---

## 3. 36개 커버리지 결과

- [exports/wf09-12/](../../../docs/03-ui-design/screens/exports/wf09-12/) 내 `.keep`을 제외하고 요구된 **36개 PNG가 모두 존재**하며, 누락되거나 추가로 섞인 파일이 없습니다.
- [screens-wf09-12.figcraft](../../../docs/03-ui-design/screens/screens-wf09-12.figcraft) 내 42개 프레임 중 작업 부품 6개(`logo-light`, `TEMPLATE-shell-desktop`, `header-mobile`, `footer-mobile`, `TEMPLATE-drawer-panel-member`, `TEMPLATE-drawer-panel-admin`)를 제외한 **36개 프레임이 PNG 36장 및 [screens.md](../../../docs/03-ui-design/screens/screens.md#L671-L690) 링크 표와 1:1 일치**합니다.
- **WF-11 상태 A 미제작:** 비관리자는 안내 없이 WF-02로 이동하는 동작이므로 차단 UI 프레임·PNG를 만들지 않고 문서([screens.md](../../../docs/03-ui-design/screens/screens.md#L628), [L662](../../../docs/03-ui-design/screens/screens.md#L662))에만 기술한 점이 올바르게 지켜졌습니다.

---

## 4. 구성 근거와 화면 일치 결과

- **WF-09 탈퇴 확인:** 1120 폭의 두 카드(664/424) + 세로 시간선 구성, 왼쪽 카드 내 상태/공유 유지 안내·점선 `[미확인]` 표시 이름 예약 자리·`취소`(secondary)/`탈퇴 확인`(danger), 오른쪽 카드 내 30일 보관·복구·삭제 시간선, 상태 A `scrim` 모달(완료 아치 메달리온 + `[문구 미확정]` + 확인), 모바일 단일 열(취소 위/탈퇴 확인 아래) 및 일반 회원 드로어 모두 문서와 일치합니다.
- **WF-10 로그인 차단 안내:** 헤더 없음·푸터 있음, 작은 가로형 로고, 전폭 수면선 위 차단 아치 메달리온, 「로그인할 수 없습니다」, 정지 차단·해제 후 재로그인 안내, 「로그인 화면으로」 primary 버튼 및 `[문구 미확정]` 주석이 문서와 일치합니다(수면선·메달리온 토큰 표기 모호함만 `minor` 1건).
- **WF-11 관리:** 비대칭 4/8 구성(왼쪽 제목+금색 수면선, 오른쪽 8열 3행 목록 카드), 각 행의 아이콘·이름·설명·점선 목적지 주석(`WF-12/13/14`)·이동 화살표, 데스크톱 회원 메뉴 열림 프레임, 관리자 모바일 드로어 모두 문서와 일치합니다.
- **WF-12 관리자 회원 목록:** 1120 전폭 표 카드, 경로(`관리 > 회원 목록`), 4열(표시 이름·이메일·정지 여부·동작), `이용 중`/`정지` 배지, `정지`/`해제` secondary 버튼, 상태 A(표 머리 유지 + 메달리온 빈 상태), 상태 B(대상 이름·이메일 + 차단/세션 유지 문구 + 취소/정지 확인 위험 버튼), 모바일 행 카드 목록(44px 버튼) 및 관리자 드로어가 문서와 일치합니다.

---

## 5. WF·AC 정합성 요약

| 화면 | 정합성 판정 | 확인된 항목 |
| --- | --- | --- |
| **WF-09 탈퇴 확인** | 충족 | 30일 보관·재가입 복구·공유/링크 유지 안내, 취소(→ WF-16), 확인 후 상태 A 완료 안내(`[문구 미확정]`) → WF-01. 표시 이름 예약 안내는 `[미확인]` 자리로만 두어 확정 기능 발명 없음. 일반 회원 헤더·드로어(관리 없음). |
| **WF-10 로그인 차단 안내** | 충족 | 제목 「로그인할 수 없습니다」, 정지 사유·기간·열린 세션 유지 표시 없음, 「로그인 화면으로」(`[문구 미확정]`) → WF-01. 헤더·드로어 없음, 푸터 있음. |
| **WF-11 관리** | 충족 | 메뉴 3개(회원 목록 → WF-12, 오픈소스 관리 → WF-13, 카테고리 관리 → WF-14). WF-13·14 화면 미제작(목적지 주석만). 상태 A 차단 UI 없음. 관리자 헤더 변형 및 드로어 적용. |
| **WF-12 관리자 회원 목록** | 충족 | 표시 이름(미설정 시 Google 이름 `Hana Park` 예시 포함)·이메일·정지 여부(이용 중/정지). 정지 시 상태 B 확인 대화상자(`[문구 미확정]`) 경유, 해제 시 확인 대화상자 없음. 행 선택·검색·정렬·페이지 나눔 등 `[미확인]` 기능 발명 없음. |
| **공통 푸터** | 충족 | 이용약관·개인정보처리방침·오픈소스 라이선스 고지·문의 `aslanhobae@gmail.com`·`Dev. Aslan0`, 회사 정보 없음(36장 전체 일관). |

---

## 6. 시각 언어 일관성

- **일반 vs 관리자 헤더·드로어:** WF-09는 일반 회원(모바일 드로어에 프로필·로그아웃만 있고 관리 없음), WF-11·12는 관리자 변형(헤더 본체는 일반 회원과 동일하게 유지하고 회원 메뉴와 모바일 드로어에만 [admin.svg](../../../docs/03-ui-design/design-system/icons/admin.svg) 아이콘과 `관리` 항목 추가)으로 일관되게 분리되었습니다. 헤더 본체에 관리 바로가기를 따로 두지 않은 이유도 [screens.md](../../../docs/03-ui-design/screens/screens.md#L606)에 명시되어 있습니다.
- **WF-10 무헤더:** v4 WF-01과 동일하게 헤더와 드로어 없이 작은 가로형 로고와 푸터만 배치했습니다.
- **아치 메달리온 & 알림:** 메달리온은 상태 표지(WF-09 A 완료, WF-10 차단, WF-12 A 빈 목록)에만 쓰이고 폼·목록·알림 안에는 쓰이지 않았습니다. 오류 아이콘은 `error` 토큰을 사용했고, 표면 계층(`bg` → `surface` → `surface-raised`)과 `accent` 장식 절제 원칙이 v4·WF-05~08과 일치합니다.

---

## 7. 시각적 균형·공간 사용·위계·정렬·미감·사용성 요약

- **WF-09 탈퇴 확인:**
  - *데스크톱 라이트*([WF-09-withdraw-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-09-withdraw-desktop-light.png)): 1440 캔버스 가운데 1120(664/424) 두 카드로 좌우 균형이 안정적이며, 위험 동작(`탈퇴 확인`)을 빨간 채움 버튼으로 분리하고 안전한 `취소`를 왼쪽에 두어 오동작 위험을 낮췄습니다.
  - *모바일 다크*([WF-09-withdraw-mobile-dark.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-09-withdraw-mobile-dark.png)): 단일 열로 자연스럽게 쌓이며 전폭 52px 버튼(`취소` 위, `탈퇴 확인` 아래)과 `surface-raised` 대비가 깔끔합니다.
- **WF-10 로그인 차단 안내:**
  - *데스크톱 라이트*([WF-10-login-blocked-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-10-login-blocked-desktop-light.png)): 중앙 축 한 열과 1440 전폭 수면선, 아치 메달리온으로 정제된 차단 화면을 이룹니다.
  - *모바일 다크*([WF-10-login-blocked-mobile-dark.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-10-login-blocked-mobile-dark.png)): 360 폭에서 줄바꿈과 전폭 52px 버튼 배치가 안정적입니다.
- **WF-11 관리:**
  - *데스크톱 라이트*([WF-11-admin-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-11-admin-desktop-light.png)): 4/8 비대칭 구성으로 1440 캔버스를 균형 있게 쓰며, 본문 아래 여백은 메뉴 3개만 두고 없는 기능을 채우지 않은 의도적 여백으로 판단됩니다.
  - *모바일 다크*([WF-11-admin-mobile-dark.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-11-admin-mobile-dark.png)): 제목+금색 수면선 아래 3행 카드가 360 폭에 잘 정돈되어 있습니다.
- **WF-12 관리자 회원 목록:**
  - *데스크톱 라이트*([WF-12-members-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-12-members-desktop-light.png)): 1120 전폭 표 카드로 열 정렬·가독성·배지/동작 버튼 위계가 명확합니다.
  - *모바일 다크*([WF-12-members-mobile-dark.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-12-members-mobile-dark.png)): 표를 행 카드 목록으로 접고 `72×44px` 동작 버튼을 오른쪽에 배치해 360 폭에서 가로 스크롤 없이 읽기 쉽고 터치하기 좋습니다. 상태 B 모달([WF-12-members-mobile-dark-state-B.png](../../../docs/03-ui-design/screens/exports/wf09-12/WF-12-members-mobile-dark-state-B.png))도 대상 회원 정보와 안내 문구, `132×44px` 취소/정지 확인 버튼이 명확합니다.

---

## 8. 토큰·다크·모바일·대비 요약

- **토큰:** [screens-wf09-12.figcraft](../../../docs/03-ui-design/screens/screens-wf09-12.figcraft) 내 `Deep Ink` 컬렉션의 Light/Dark 모드 색상 값이 [design-system.md](../../../docs/03-ui-design/design-system/design-system.md#L11-L43)와 정확히 일치합니다(DS 22개 + 파일 내부 `wordmark` 보조 변수 1개). 임의 색, Grove Mint, Lucide 잔여, `secondary`/`accent` 텍스트 오용은 발견되지 않았습니다.
- **다크 모드:** 36장 모두 라이트/다크 패리티가 유지되며, 다크 모드에서 라이트 색 잔존이나 `scrim`/`overlay` 누락은 없습니다.
- **모바일:** 360 폭에서 잘림·겹침이 없고, 측정한 모든 모바일 조작 버튼(메뉴 `44×44`, WF-09 `328×52`, WF-12 행 `72×44`, 모달 `132×44`)이 44px 이상입니다.
- **WCAG 2.1 AA 대비:** 주요 토큰 쌍 계산 결과 텍스트(4.5:1)와 UI 경계(3.0:1) 기준을 모두 통과했습니다.
  - 라이트 최저 주요 쌍: `success` / `success-subtle` (`#1E7A4C` / `#E8F5ED`) **4.75:1**, `border-strong` / `surface-raised` (`#738298` / `#FFFFFF`) **3.91:1**
  - 다크 최저 주요 쌍: `error` / `error-subtle` (`#F2766B` / `#422630`) **4.88:1**, `border-strong` / `surface-raised` (`#7487A3` / `#1C283C`) **4.05:1**

---

## 9. DEC-084·101 처리 결과

- **DEC-084:** 이 묶음(WF-09~12)에는 마우스 올림 썸네일 대상 화면이 없으며, 생략 원칙과 충돌하는 요소가 없습니다.
- **DEC-101:** 36개 프레임 및 모바일 드로어(일반 회원·관리자) 어디에도 테마 선택기를 확정 배치하지 않아 Q-090 미정 원칙을 준수했습니다.

---

## 10. 검토하지 못한 부분과 그 이유

- **실제 글꼴(`IBM Plex Sans KR`) 렌더링·줄바꿈·키보드 포커스·스크린리더 읽기 순서·호버/눌림 상태:** 헤드리스 FigCraft 내보내기 PNG 및 정적 시안 범위 밖이므로 `[미확인]`으로 남깁니다.
- **WF-09·10·11·12의 로딩/처리 실패/비로그인 직접 접근 상태:** 기획 v1.0 및 `screen-data-actions.md`에서 `[미확인]`으로 비어 있는 영역이며 시안에도 발명하지 않았으므로 확인 대상에서 제외되었습니다.
