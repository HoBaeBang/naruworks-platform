<!-- naru-orch job=P3-4-screens-wf13-16-review-12 provider=antigravity model=gemini-4-hydrogen-medium agent=c533d427-933b-4608-856a-530aac785759 saved=2026-11-20T11:13:36+09:00 -->

## 1. 요약

- **판정:** **수정 필요** (문서-화면 불일치 1건)
- **심각도별 개수:** `blocking` **0건** / `major` **1건** / `minor` **4건**

전반적으로 Deep Ink(브랜드 A, DES-002) 시각 언어, v4·WF-05~08·WF-09~12에서 확정된 4/8 비대칭 데스크톱 레이아웃(1440px 캔버스, 본문 1120px), 일반/관리자 헤더 및 모바일 드로어 패턴, WCAG AA 대비, DEC-084·101·068을 충실히 준수했다. v1에서 지적되었던 「데스크톱 내용이 왼쪽 좁은 열에만 몰리는 문제」는 재발하지 않았다. 다만 [screens.md](../../../docs/03-ui-design/screens/screens.md#L759)의 WF-15 구성 근거와 실제 시안의 「저장」 버튼 스타일이 모순되는 `major` 1건이 확인되었다.

---

## 2. 발견 목록

| 번호 | 심각도 | 위치 | 내용 | 근거 | 수정 제안 |
|---|---|---|---|---|---|
| 1 | `major` | [screens.md](../../../docs/03-ui-design/screens/screens.md#L759) ↔ [WF-15-profile-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf13-16/WF-15-profile-desktop-light.png) 외 WF-15 전 시안 | WF-15 「저장」 버튼이 문서에는 `secondary`로 기술되어 있으나, 실제 프레임과 PNG에는 `primary` 버튼으로 그려짐 | `screens.md` 759행: 「입력 옆 secondary 버튼 한 개의 최소 자리만 둔다」 / `screens-wf13-16.figcraft` `button-save` fill: `#1E3A5F`(`primary`), 라벨 `#FFFFFF`(`on-primary`) | `screens.md` 759행 기술을 실제 시안(`primary` 버튼)에 맞게 고치거나, 시안의 「저장」 버튼을 `secondary`로 수정(프로필 주요 저장 동작이므로 문서를 `primary`로 맞추는 편이 자연스러움) |
| 2 | `minor` | [WF-14-categories-desktop-light.png](../../../docs/03-ui-design/screens/exports/wf13-16/WF-14-categories-desktop-light.png) · [screens.md](../../../docs/03-ui-design/screens/screens.md#L856) | 「+ 카테고리 추가」에서 DS 아이콘 대신 텍스트 기호 `+`를 사용 | [design-system.md](../../../docs/03-ui-design/design-system/design-system.md#L114-L152) 37개 아이콘 세트에 `plus` 아이콘이 없어 문자로 대체(`screens.md` 856행) | 구현 또는 DS 보완 시 커스텀 `plus` 아이콘 추가 여부 검토 |
| 3 | `minor` | [WF-15-profile-desktop-light-state-B.png](../../../docs/03-ui-design/screens/exports/wf13-16/WF-15-profile-desktop-light-state-B.png) · [screens.md](../../../docs/03-ui-design/screens/screens.md#L856) | 표시 이름 오류 안내 아이콘에 `warning` 아이콘을 `error` 색상으로 재사용 | DS에 별도 `error` 전용 아이콘이 없어 `warning` 아이콘을 `error` 색으로 적용(`screens.md` 856행) | 현 시안 유지 가능하나, DS 아이콘 용도 정의에 오류 배너/인라인 오류 시 `warning` 아이콘 재사용 규칙 명시 권장 |
| 4 | `minor` | [screens-wf13-16.figcraft](../../../docs/03-ui-design/screens/screens-wf13-16.figcraft) · [screens.md](../../../docs/03-ui-design/screens/screens.md#L856) | 카드·알림·드로어 그림자 색상이 모드 변수에 묶이지 않고 고정 값 사용 | `screens.md` 856행 한계 기록과 동일(다크에서도 라이트 기반 그림자 값 사용) | DS 엘리베이션 토큰과 맞춰 다크 모드 그림자 분리 적용 권장 |
| 5 | `minor` | [WF-15-profile-mobile-light.png](../../../docs/03-ui-design/screens/exports/wf13-16/WF-15-profile-mobile-light.png) 외 모바일 PNG · [screens.md](../../../docs/03-ui-design/screens/screens.md#L854-L857) | 헤드리스 렌더링 대체 글꼴 사용 및 모바일 일부 도움말 수동 줄바꿈 | IBM Plex Sans KR 미탑재로 대체 글꼴 렌더링, WF-14/15 모바일 도움말에 `\n` 수동 줄바꿈 포함 | 실제 구현 시 웹폰트(IBM Plex Sans KR) 기준 자연 줄바꿈 확인 필요 |

---

## 3. 48개 커버리지 결과

- **경로:** `docs/03-ui-design/screens/exports/wf13-16/`
- **결과:** **48개 전체 존재** (누락 0개, 추가 파일 0개, `.keep` 제외).
  - WF-13: 14개 (기본·상태 A·상태 B × 4종 + 드로어 2종)
  - WF-14: 10개 (기본·상태 A × 4종 + 드로어 2종)
  - WF-15: 18개 (기본·상태 A·상태 B·상태 C × 4종 + 드로어 2종)
  - WF-16: 6개 (기본 × 4종 + 드로어 2종)
- [screens.md](../../../docs/03-ui-design/screens/screens.md#L804-L826) PNG 링크 표 및 [screens-wf13-16.figcraft](../../../docs/03-ui-design/screens/screens-wf13-16.figcraft) 내보내기 대상 48개 프레임(`TEMPLATE-*` 4개, 아이콘·로고 마스터 18개 제외)과 1:1 일치한다.

---

## 4. 구성 근거와 화면 일치 결과

- **WF-13:** 일치. 4/8 비대칭 구성, 목록 카드(이름·노출 상태·동작), 카드 아래 `info` 숨김 안내, 상태 A(Litpage `숨김` 배지 + `노출` 버튼), 상태 B(카드 위 나루 드라이브 유지 `info` 배너 추가)가 문서와 동일하다.
- **WF-14:** 일치. 4/8 비대칭 구성, 왼쪽 반영 안내(저장 버튼 없음), 오른쪽 「카테고리」·「서비스 배정」 두 카드 분리, 상태 A(「문서」 줄에 `노출 중인 서비스 없음` 배지, Litpage 줄에 `숨김` 배지)가 문서와 동일하다.
- **WF-15:** **부분 불일치(`major`).** 왼쪽 보기 전용 열(계정·사용량·계정 설정 행) + 오른쪽 편집 열(표시 이름·화면 언어), 상태 A(점선 원 아바타 + 안내), 상태 B(오류 경계 + 아이콘·문구), 상태 C(`0 B`, 막대 없음)는 모두 일치하나, 「저장」 버튼만 문서(`secondary`)와 화면(`primary`)이 다르다.
- **WF-16:** 일치. 4/8 구성, 경로(`프로필 > 계정 설정`), 「탈퇴」 메뉴 한 줄 카드만 배치하고 다른 설정을 추가하지 않았다.
- **스킬 적용 기록 표:** [screens.md](../../../docs/03-ui-design/screens/screens.md#L771-L778)의 적용 규칙(수면선, 4/8 정렬, 44px 터치, 카드 안 카드 금지, 가짜 지표/사진 금지, 인라인 오류)은 실제 시안과 부합한다.

---

## 5. WF·AC 정합성 요약

[screen-data-actions.md](../../../docs/03-ui-design/screen-data/screen-data-actions.md#L462-L572) 기준:
- **WF-13:** 오픈소스 이름(Litpage), 노출 상태 배지, 숨김 안내, 숨김/노출 동작 모두 포함. 확인 대화상자 없음(DEC-068). 나루 드라이브를 숨김 목록에 넣지 않음. `[미확인]`인 행 선택·검색·정렬·페이지 나눔을 발명하지 않음. 상태 A·B 충족.
- **WF-14:** 기본 카테고리(문서·저장소), 서비스 배정(Litpage→문서, 나루 드라이브→저장소), 즉시 반영 안내(저장 버튼 없음), 이름 변경·삭제·+ 카테고리 추가·드롭다운 포함. `[미확인]`인 추가 입력 UI·삭제 확인 대화상자를 발명하지 않음. 상태 A는 관리 화면 내 상태로 표현했고 회원용 WF-02 빈 상태를 재그리지 않음.
- **WF-15:** Google 계정 이름·이메일(보기 전용), 단색 이니셜 아바타(가짜 인물 사진 미사용), 표시 이름 입력·규칙·비울 수 없음 안내·저장 버튼, 화면 언어 라디오(한국어/영어), 드라이브 사용량(한도·막대 없음), 계정 설정 링크 포함. 탈퇴 메뉴·테마 선택기 없음. 상태 A·B·C 충족.
- **WF-16:** 제목 「계정 설정」, 「탈퇴」 메뉴(→ WF-09)만 배치. 타 설정 항목 발명 없음.
- **공통 푸터:** 이용약관, 개인정보처리방침, 오픈소스 라이선스 고지, 문의 이메일(`aslanhobae@gmail.com`), `Dev. Aslan0` 포함, 회사 정보 없음.

---

## 6. 시각 언어 일관성

- **일반 회원 헤더·드로어 (WF-15·16):** 데스크톱 헤더에 로고·서비스 전환·카테고리·회원 아이콘 버튼, 모바일 드로어에 닫기(`×`)·서비스·카테고리·프로필·로그아웃만 존재하며 **관리 메뉴 및 테마 선택기 없음**. WF-15 드로어는 `프로필`에 `surface-hover` 현재 위치 표시, WF-16 드로어는 현재 위치 표시 없음.
- **관리자 헤더·드로어 (WF-13·14):** 데스크톱 헤더 본체는 일반 회원과 동일(관리 바로가기 별도 추가 없음, WF-11과 일치). 모바일 드로어에 `프로필`·**`관리`**(`surface-hover` 현재 위치 표시)·`로그아웃` 포함.
- **아치 메달리온·알림·표면·액센트:** 폼·목록·알림 안에 아치 메달리온 미사용. 알림(`info`)은 주 흐름을 끊지 않는 카드 상/하단 보조 배너로 배치. 오류 아이콘·경계·문구는 `error` 토큰 사용. 표면은 `surface` 바탕 → `surface-raised` 카드 위계 유지. 골드 `accent`는 제목 아래 수면선 장식에만 절제해 사용.

---

## 7. 시각적 균형·공간 사용·위계·정렬·미감·사용성 요약

- **WF-13** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/wf13-16/WF-13-oss-desktop-light.png) · [모바일 다크](../../../docs/03-ui-design/screens/exports/wf13-16/WF-13-oss-mobile-dark.png)): 1440px 캔버스에서 4/8 열이 상단 정렬되어 균형이 잡혀 있으며, 1차 오픈소스(Litpage) 1개뿐인 상황에서도 빈 공간을 억지 요소로 채우지 않고 정돈된 표 형태를 유지했다. 모바일 다크에서는 카드 내 `Litpage` + `노출` 배지 아래 전폭 44px `숨김` 버튼과 `info` 배너가 명확한 위계로 읽힌다.
- **WF-14** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/wf13-16/WF-14-categories-desktop-light.png) · [모바일 다크](../../../docs/03-ui-design/screens/exports/wf13-16/WF-14-categories-mobile-dark.png)): 카테고리 관리와 서비스 배정을 두 카드로 분리해 역할 혼동을 막았다. 모바일 다크에서도 `이름 변경`/`삭제` 버튼(높이 44px)과 셀렉트 박스가 겹침 없이 정돈되어 있다.
- **WF-15** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/wf13-16/WF-15-profile-desktop-light.png) · [모바일 다크](../../../docs/03-ui-design/screens/exports/wf13-16/WF-15-profile-mobile-dark.png)): 보기 전용(왼쪽 4열)과 변경 가능 항목(오른쪽 8열)의 공간 분할이 직관적이며 좌우 열 하단 높이도 안정적으로 맞는다. 모바일 다크에서도 카드 흐름(계정→표시 이름→언어→사용량→계정 설정)과 오류/빈 사진 상태가 맥락 손실 없이 이해된다.
- **WF-16** ([데스크톱 라이트](../../../docs/03-ui-design/screens/exports/wf13-16/WF-16-account-desktop-light.png) · [모바일 다크](../../../docs/03-ui-design/screens/exports/wf13-16/WF-16-account-mobile-dark.png)): 데스크톱 본문 아래 여백이 넓으나, 1차 결정 항목이 「탈퇴」 하나뿐이므로 없는 기능을 발명하지 않은 의도적 여백이다(죽은 공간 재발 아님). 모바일 다크에서도 72px 이상 높이의 탈퇴 행이 명확한 터치 타겟을 제공한다.

---

## 8. 토큰·다크·모바일·대비 요약

- **토큰·브랜드:** `Deep Ink` 컬렉션(Light/Dark) 22개 변수 + 파일 내부 `wordmark` 보조 변수만 사용. Grove Mint, Lucide 잔여, `secondary`/`accent` 텍스트 오용 없음. 커스텀 SVG 아이콘 세트 사용(`plus` 제외).
- **다크 모드:** 라이트/다크 패리티 정상. 라이트 색 잔존이나 저대비 붕괴 없음. 모바일 드로어 뒤 `overlay` 차폐 정상 적용.
- **모바일(360px):** 가로 넘침·잘림·겹침 없음. 버튼·라디오·행 터치 영역 모두 44px 이상(`button-save` 44px, `button-hide` 44px, `button-rename`/`delete` 44px, `radio-ko` 52px, `button-add-category` 56px). 푸터 세로 스택 정상.
- **대비(WCAG 2.1 AA, 반올림 전 실측 계산 기준):** [tokens.json](../../../docs/03-ui-design/design-system/tokens.json) hex 기준 주요 사용 쌍 모두 통과.
  - `text`/`bg`: 라이트 17.2843:1, 다크 15.9265:1
  - `text`/`surface-raised`: 라이트 17.2843:1, 다크 12.5963:1
  - `text`/`surface-hover`: 라이트 14.8184:1, 다크 10.6518:1
  - `text-muted`/`surface-raised`: 라이트 7.4411:1, 다크 6.0717:1
  - `primary`/`surface-raised`: 라이트 11.5026:1, 다크 7.0371:1
  - `on-primary`/`primary`: 라이트 11.5026:1, 다크 8.8975:1
  - `success`/`success-subtle`: 라이트 4.7459:1, 다크 5.7017:1
  - `warning`/`warning-subtle`: 라이트 5.6058:1, 다크 6.4844:1
  - `info`/`info-subtle`: 라이트 5.4075:1, 다크 5.5539:1
  - `error`/`surface-raised`: 라이트 6.5743:1, 다크 5.3444:1
  - `border-strong`/`surface-raised`: 라이트 3.9067:1, 다크 4.0455:1 (3:1 이상 통과)

---

## 9. DEC-084·101 처리 결과

- **DEC-084 (터치 기기 마우스 올림 썸네일 생략):** WF-13~16 묶음에는 파일 썸네일 화면이 없으며, 해당 없음으로 정상 처리됨.
- **DEC-101 (테마 선택기 미배치):** WF-15 프로필 및 모든 화면·모바일 드로어에 테마 선택기를 배치하지 않음. 라이트/다크 프레임은 디자이너용 시안으로만 분리됨.

---

## 10. 검토하지 못한 부분과 그 이유

- **개별 PNG 미열람 14장 (`[미확인]`):** 48장 중 34장(WF-13 8장, WF-14 8장, WF-15 12장, WF-16 6장)을 직접 열람해 검증했다. 나머지 14장(`WF-13` dark-state-A/B, mobile-light-state-A, mobile-dark-state-A, mobile-light-drawer; `WF-14` mobile-dark-state-A, mobile-light-drawer; `WF-15` dark-state-A/C, mobile-light-state-B/C, mobile-dark-state-A/C)은 동일 구조의 모드/상태 변형으로 개별 PNG 이미지를 직접 열지 않아 픽셀 단위 렌더링은 `[미확인]`이다.
- **인터랙션·접근성 동적 동작 (`[미확인]`):** 키보드 포커스 이동 순서, `aria-live` 알림 동작, 호버/눌림/비활성 프레임(시안에 미포함) 및 실제 웹폰트(IBM Plex Sans KR) 적용 시의 줄바꿈은 정적 시안 및 헤드리스 PNG 환경상 검증할 수 없어 `[미확인]`이다.
