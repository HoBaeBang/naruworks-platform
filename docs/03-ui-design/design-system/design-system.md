# NaruWorks 디자인 시스템

기획 v1.0 · DES-002 브랜드 A ‘Deep Ink (먹빛 나루)’ 채택 · NARU-93 승인② 초안

신뢰 · 차분 · 정돈을 기준으로 삼는다. NFR v1.1에 따라 PC·모바일 반응형 웹과 한국어·영어를 지원한다. 라이트·다크와 WCAG AA 대비는 승인②의 디자인 전제다. [디자인 결정 기록](../design-decisions.md) · [브랜드 A](../brand/brand-concepts.md) · [NFR](../../01-planning/nfr/NFR.md) · [와이어프레임](../../01-planning/wireframe/WF.figcraft)

## 컬러 토큰

FigCraft의 `Deep Ink` 컬렉션은 라이트와 다크에 같은 색 토큰 31개를 제공한다. JSON은 `color.light`와 `color.dark`에 같은 키를 사용한다. 알파가 있는 값은 표와 JSON 확장 필드에 `#RRGGBBAA`로 표기한다.

| 토큰 | 라이트 HEX | 다크 HEX | 용도 |
| --- | --- | --- | --- |
| `bg` | `#FFFFFF` | `#0B1220` | 페이지 바탕 |
| `surface` | `#F4F6FA` | `#141D2E` | 그룹·비활성 컨트롤 바탕 |
| `surface-raised` | `#FFFFFF` | `#1C283C` | 카드·메뉴·대화상자 |
| `surface-hover` | `#E8EEF7` | `#25344D` | 중립 인터랙션 호버 |
| `surface-pressed` | `#DCE6F4` | `#2B3851` | 중립 인터랙션 눌림 |
| `text` | `#0F1B2D` | `#E8EDF5` | 본문·제목·아이콘 |
| `text-muted` | `#4A5668` | `#9AA7BA` | 보조 문구·힌트·비활성 레이블 |
| `border` | `#D5DBE5` | `#2A364B` | 장식용 구분선 |
| `border-strong` | `#738298` | `#7487A3` | 입력·컨트롤의 필수 경계 |
| `primary` | `#1E3A5F` | `#8DB4F5` | 주요 동작·링크·심볼 |
| `on-primary` | `#FFFFFF` | `#0B1220` | 주요 동작 위 레이블·심볼 선 |
| `primary-hover` | `#284E7A` | `#A3C4FA` | 주요 동작 호버 |
| `primary-pressed` | `#172D49` | `#749CE0` | 주요 동작 눌림 |
| `secondary` | `#3E6FB0` | `#5B8DD6` | 보조 그래픽·진행 표시 전용(텍스트 금지) |
| `accent` | `#D4A24C` | `#E3B866` | 장식용 금색 포인트 |
| `focus` | `#1D5FBF` | `#8DB4F5` | 2px 포커스 링, 바깥 여백 2px |
| `success` | `#1E7A4C` | `#4CC38A` | 성공 텍스트·아이콘 |
| `success-subtle` | `#E8F5ED` | `#17392F` | 성공 배경 |
| `warning` | `#8C5900` | `#E5B03C` | 주의 텍스트·아이콘 |
| `warning-subtle` | `#FFF8EA` | `#3C3020` | 주의 배경 |
| `error` | `#B42318` | `#F2766B` | 오류 텍스트·아이콘·위험 버튼 |
| `error-subtle` | `#FCEBE9` | `#422630` | 오류 배경 |
| `info` | `#1D5FBF` | `#6AA8FF` | 정보 텍스트·아이콘 |
| `info-subtle` | `#E9F2FF` | `#172F50` | 정보 배경 |
| `on-danger` | `#FFFFFF` | `#0B1220` | 위험 버튼 레이블 |
| `danger-hover` | `#9D1F16` | `#FF8C83` | 위험 버튼 호버 |
| `danger-pressed` | `#861A11` | `#E16B62` | 위험 버튼 눌림 |
| `overlay` | `#0B122066` | `#00000080` | 메뉴 드로어·시트 뒤 40%/50% 차폐 |
| `scrim` | `#0B122099` | `#000000B3` | 모달 뒤 60%/70% 차폐 |
| `tooltip-bg` | `#1E3A5F` | `#E8EDF5` | 툴팁 바탕 |
| `on-tooltip` | `#FFFFFF` | `#0B1220` | 툴팁 레이블 |

### 토큰 확장 근거

- `surface-raised`는 라이트에서 흰색과 장식 구분선, 다크에서 명도를 높인 네이비로 일반 표면과 구분한다. 호버와 눌림은 네이비 계열 안에서 단계화하며 두 모드에서 보조 문구 대비를 4.5:1 이상으로 유지한다.
- 주요 버튼은 호버에서 명도를 높이고 눌림에서 낮춘다. 위험 버튼은 error에서 파생하고 라이트 흰색과 다크 짙은 잉크 레이블을 쓴다. 레이블과 버튼 경계의 대비를 각각 측정했다.
- 상태 배경은 네 가지 상태색의 옅은 라이트 틴트와 어두운 다크 틴트다. 라이트 `warning-subtle`은 주의 레이블이 4.5:1을 넘도록 명도를 높였다. 초록은 성공 상태에서 사용한다.
- `border`는 장식용 구분선에, `border-strong`은 입력·보조 버튼처럼 식별이 필요한 경계에 쓴다. 금색 `accent`는 장식, `secondary`는 보조 그래픽·진행 표시 전용이며 텍스트에 쓰지 않는다. 레이블은 `primary` 또는 `text`/`text-muted`를 쓴다.
- `focus`는 2px 링과 2px의 바깥 간격으로 조작 요소 주변에서 식별한다. `overlay`와 `scrim`은 비활성 바탕을 차폐한다. 조작 요소와 본문은 불투명한 패널에 둔다.

## 타이포그래피

한글·본문에는 IBM Plex Sans KR, 영문 보조와 워드마크에는 IBM Plex Sans를 쓴다. 두 계열은 SIL OFL 1.1이다. FigCraft 헤드리스에 IBM Plex Sans KR이 없어 일반 텍스트 PNG는 대체 글꼴로 렌더링된다. 워드마크는 공식 IBM Plex Sans Bold 글리프 윤곽을 사용한다. [IBM Plex 원본](https://github.com/IBM/plex) · [글리프 소스](https://github.com/IBM/plex/blob/master/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-Bold.ttf)

| 역할 | 데스크톱 크기 / 행간 | 모바일 크기 / 행간 | 굵기 |
| --- | --- | --- | --- |
| `display` | 48 / 56 px | 36 / 44 px | 700 |
| `h1` | 40 / 48 px | 32 / 40 px | 700 |
| `h2` | 28 / 36 px | 24 / 32 px | 700 |
| `h3` | 20 / 28 px | 20 / 28 px | 700 |
| `h4` | 18 / 24 px | 18 / 24 px | 600 |
| `body` | 16 / 26 px | 16 / 26 px | 400 |
| `body-sm` | 14 / 22 px | 14 / 22 px | 400 |
| `caption` | 12 / 18 px | 12 / 18 px | 400 |
| `label` | 14 / 20 px | 14 / 20 px | 600 |

한·영 전환으로 텍스트가 길어지면 행을 늘리고, 주요 동작의 전체 이름을 유지한다.

## 스페이싱 · 라디우스 · 엘리베이션

- 4px 기반 스페이싱은 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px다.
- 라디우스는 0, 4, 8, 12, 16, 24, 9999px(pill)다. 작은 표시는 4px, 입력과 버튼은 8px, 메뉴와 카드는 12px, 큰 컨테이너는 16px를 기본으로 한다.
- sm/md/lg 버튼 높이는 36/44/52px다. 터치 환경의 조작 영역은 44×44px 이상이다.

| 레벨 | 용도 | x / y / blur / spread (px) | 라이트 색상 | 다크 색상 |
| --- | --- | --- | --- | --- |
| 1 | 표면 카드 | 0 / 2 / 8 / 0 | `#0F1B2D1A` | `#0000004D` |
| 2 | 드롭다운·팝오버 | 0 / 8 / 24 / 0 | `#0F1B2D26` | `#00000066` |
| 3 | 모달·시트 | 0 / 16 / 40 / 0 | `#0F1B2D33` | `#00000080` |

다크 패널은 그림자와 함께 `surface-raised`로 표면을 구분한다.

## 브레이크포인트 · 그리드

| 구간 | 최소 폭 | 열 | 좌우 여백 | 거터 | 최대 컨테이너 |
| --- | --- | --- | --- | --- | --- |
| mobile | 360px | 4 | 16px | 16px | 가변 |
| tablet | 768px | 8 | 24px | 20px | 가변 |
| desktop | 1200px | 12 | 32px | 24px | 1440px |

모바일 기준 폭은 360px다. 긴 한·영 레이블을 담는 메뉴 드로어와 푸터는 세로로 흐른다. 좁은 화면의 관리자 표는 표 안에서 가로 스크롤한다.

## 모션

즉시 0ms, 빠른 상태 전환 120ms, 기본 전환 180ms, 모달·드로어 전환 240ms. 기본 easing은 `cubic-bezier(0.2, 0, 0, 1)`, 닫힘은 `cubic-bezier(0.4, 0, 1, 1)`이다. 동작 줄이기를 설정하면 지속 시간을 0ms로 바꾸고 로딩 문구나 정적 진행 표시를 유지한다.

## 브랜드 자산

두 기슭을 잇는 아치와 수면선이 있는 심볼과 NaruWorks 워드마크를 쓴다. 사방의 클리어 스페이스는 심볼 높이의 ¼, 최소 높이는 가로형 24px와 단독 심볼 16px다. 16px에서 아치, 32px와 180px에서 아치와 수면선을 확인했다. 180px는 앱 아이콘용이다.

- [라이트 로고](assets/logo-light.svg) · [다크 로고](assets/logo-dark.svg) · [기본 심볼](assets/symbol.svg)
- [라이트 크기 검사](exports/brand-assets-light.png) · [다크 크기 검사](exports/brand-assets-dark.png)

## 아이콘 제안

**승인 필요.** Lucide(ISC) 37개를 검토 대상으로 배치했다. 기본 24px 그리드와 2px 선을 사용한다. 단독 아이콘 버튼에는 접근 가능한 이름을 제공하고, 같은 정보를 전달하는 보조 아이콘은 스크린리더에서 숨긴다. PDF는 `file-type`과 ‘PDF’ 레이블을 함께 쓴다. [Lucide 원본](https://github.com/lucide-icons/lucide) · [라이선스](https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE)

| 용도 | Lucide 이름 |
| --- | --- |
| 홈 | `house` |
| 드라이브 | `hard-drive` |
| 폴더 | `folder` |
| 문서 | `file-text` |
| 이미지 | `file-image` |
| PDF | `file-type` |
| 동영상 | `file-video` |
| 오디오 | `file-audio` |
| 압축 | `file-archive` |
| 기타 파일 | `file` |
| 올리기 | `upload` |
| 내려받기 | `download` |
| 공유 | `share-2` |
| 링크 | `link` |
| 휴지통 | `trash-2` |
| 복원 | `archive-restore` |
| 더 보기 | `ellipsis` |
| 검색 | `search` |
| 정렬 | `arrow-down-up` |
| 그리드 보기 | `layout-grid` |
| 목록 보기 | `list` |
| 회원 | `user` |
| 설정 | `settings` |
| 로그아웃 | `log-out` |
| 관리 | `shield` |
| 언어 | `globe` |
| 밝게 | `sun` |
| 어둡게 | `moon` |
| 시스템 | `monitor` |
| 닫기 | `x` |
| 확인 | `check` |
| 주의 | `triangle-alert` |
| 정보 | `info` |
| 펼치기 | `chevron-down` |
| 다음 | `chevron-right` |
| 메뉴 | `menu` |
| 진행 중 | `loader-circle` |

## 컴포넌트 인벤토리

FigCraft에 컴포넌트 세트 30개를 두었다. 라이트 보드의 원본과 다크 보드의 연결된 인스턴스는 같은 변형을 사용한다. 표의 ‘확장 예시’와 ‘표현’은 WF에 적용할 디자인 예시다.

| 컴포넌트 | 변형 | 상태 | WF |
| --- | --- | --- | --- |
| Button | primary · secondary · ghost · danger / sm · md · lg | default · hover · pressed · focus · disabled · loading | WF-01~16 |
| Icon button | 기본 · 파일/행 액션 | default · hover · pressed · focus · disabled · loading | WF-05~08, WF-12~15 |
| Text field | 빈 입력 · 입력됨 | default · hover · focus · disabled · error | WF-03, WF-05, WF-07, WF-14~15 |
| Search field | 기본 · 검색어 · 검색 중 | default · hover · focus · disabled · loading · error | WF-07 · WF-05/12 확장 예시 |
| Select / Dropdown | 닫힘 · 펼침 | default · hover · focus · disabled · error | WF-07, WF-14 |
| Checkbox | 미선택 · 선택 · 혼합 | default · hover · pressed · focus · disabled | WF-05 상태 D, WF-07 |
| Radio | 미선택 · 선택 | default · hover · pressed · focus · disabled | WF-07, WF-15 |
| Toggle | 꺼짐 · 켜짐 | default · hover · pressed · focus · disabled | WF-05, WF-13 |
| Segmented control | 시스템/밝게/어둡게 · 한국어/EN | 각 선택값 · hover · pressed · focus · disabled | WF-15 (테마는 설계 제안) |
| Tabs | 폴더 · 파일 | default · hover · pressed · focus · disabled | WF-05, WF-11 (확장 예시) |
| Breadcrumb | 링크 · 현재 위치 | default · hover · focus | WF-03, WF-05~06 |
| Drive navigation | 데스크톱 사이드바 · 모바일 드라이브 메뉴 / 내 드라이브 · 휴지통(현재 위치) | default · current | WF-05, WF-06 |
| Badge / Tag | neutral · success · warning · error · info | 기본 | WF-05, WF-07, WF-12~14 |
| Avatar | 사진 슬롯 · 이니셜 · 기본 | 기본 | WF-02, WF-07, WF-12, WF-15 |
| Tooltip | 미표시 · 위에 표시 | hover · focus | WF-05, WF-12 (보조) |
| Menu | 서비스 · 파일 · 회원 일반 · 회원 관리자 | default · hover · pressed · focus · disabled | WF-02, WF-05, WF-12 |
| Toast / Snackbar | success · error · info / 닫기 | 기본 | WF-04~07, WF-12, WF-15 (결과 표현) |
| Inline alert / Banner | success · warning · error · info | 기본 | WF-03~10, WF-13~15 |
| Empty state | 빈 폴더 · 빈 휴지통 | 기본 | WF-02, WF-05~06, WF-12, WF-14 |
| Skeleton / Loading | 목록 · 카드 | loading | WF-02, WF-05, WF-07, WF-12 (대기 표현) |
| Progress | 전송 · 완료 · 실패 · 취소됨 | 진행/취소 · 완료 · 실패/재시도 | WF-05 (전송 상태 디자인) |
| Dialog / Modal | 확인 · 파괴적 · 링크 공유 · 라이선스 · 폴더 만들기 · 이름 변경 · 저장 폴더 선택 · 이동 대상 선택 | default · loading · error | WF-02, WF-03, WF-05, WF-09, WF-12 |
| Share dialog / Member sharing page | 모달(WF-05 상태 D) · WF-07 독립 화면(데스크톱·모바일, 권한 Radio) | default · loading · error | WF-07 · WF-05 상태 D |
| Bottom sheet | 파일 · 휴지통 복원 | default · focus | WF-05~06 (모바일 적용) |
| Pagination | 현재 · 첫 · 마지막 | default · hover · pressed · focus · disabled | WF-05, WF-12~14 (확장 예시) |
| Admin table | 회원 · 오픈소스 · 카테고리 | default · 행 hover · 행 액션 focus · loading · empty | WF-12~14 |
| File list row | 파일 · 폴더 · 휴지통 · 모바일 · 데스크톱 호버 썸네일 | default · hover · pressed · focus · selected | WF-03, WF-05~06 |
| File grid card | 파일 · 데스크톱 호버 썸네일 · 모바일 유형 표시 | default · hover · pressed · focus · selected | WF-05 (목록의 그리드 변형) |
| Service card | Litpage · 나루 드라이브 | default · hover · pressed · focus | WF-02, WF-11 |
| Common header | 데스크톱 일반/관리/비회원(로고·서비스 전환·문서/저장소·로그인) · 모바일 닫힘/메뉴 드로어(비회원도 서비스 전환·카테고리) | default · open | WF-02~07, WF-08 비회원, WF-09, WF-11~16 |
| Common footer | 데스크톱 · 모바일 | default | WF-01~16 |

### 와이어프레임 적용과 승인 전제

- 공통 헤더는 로고에서 WF-02 홈, 서비스 전환에서 WF-04/05, 카테고리에서 WF-02 해당 섹션으로 이동한다. 일반 회원 메뉴에는 프로필·로그아웃이 있고 관리자는 관리 메뉴를 추가로 본다. WF-08 비회원 헤더에는 로그인 진입을 둔다.
- 공통 푸터는 법적 문서(한·영, 새 창), 공개 문의 이메일, 오픈소스 라이선스(같은 창 대화상자), `Dev. Aslan0`을 제공한다. WF 기준에는 개인 개발자 표기가 있다. 회사·사업자·운영자 정보 표시 요건은 Q-081 [미확인]이다.
- WF-07은 전체 이메일 완전 일치 조회와 보기/편집 권한, 다운로드 허용을 다룬다. WF-05 링크 공유는 다운로드 허용 선택을 제공한다. 업로드 진행·취소는 WF-05에 덧붙인 전송 상태 디자인이다.
- WF-05 데스크톱은 포인터 호버가 가능한 환경에서 이미지·PDF·동영상 대표 썸네일을 표시한다. 모바일은 호버 썸네일 없이 파일 유형과 이름을 바로 보여 준다. GAP-017 기준선 반영 여부는 [미확인]이며 모바일 처리는 이 초안의 전제다.
- WF-06 휴지통은 남은 기간, 원래 위치와 복원을 제공한다. WF-12 회원 정지는 확인 대화상자를 거치고 기존 세션은 로그아웃까지 이어진다.
- 테마의 시스템/밝게/어둡게 선택과 저장 위치는 승인 대상이다. 화면 언어는 WF-15에서 변경하고 다음 방문에도 유지한다.
- 오버레이를 열면 배경 조작을 막고 포커스를 안에 유지한다. 닫을 때는 트리거로 포커스를 돌려준다. 모바일 시트에는 눈에 보이는 닫기 버튼을 둔다.

## WCAG AA 대비 측정

sRGB를 선형화한 상대 휘도로 `(L밝음 + 0.05) / (L어두움 + 0.05)`를 계산했다. 판정은 반올림 전 값을 사용한다. 일반 텍스트는 4.5:1, 큰 텍스트와 필수 UI·포커스 링은 3:1이다. 큰 텍스트는 일반 24 CSS px 이상 또는 굵은 18.67 CSS px 이상이다. [WCAG 2.2 텍스트 대비](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) · [비텍스트 대비](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)

검증 쌍은 두 모드에서 텍스트·UI 기준을 통과했다(장식·그래픽 전용 참고쌍은 제외). 일반 텍스트 최솟값은 라이트 4.70:1(`warning` / `surface-pressed`, 반올림 전 4.7032:1) / 다크 4.82:1, 큰 텍스트·UI 최솟값은 라이트 3.10:1(`border-strong` / `surface-pressed`, 반올림 전 3.1008:1) / 다크 3.21:1(같은 쌍, 반올림 전 3.2101:1)이다.

| 전경 / 배경 | 기준 | 라이트 측정 | 다크 측정 | 용도 |
| --- | --- | --- | --- | --- |
| `error` / `error-subtle` | 4.5:1 | 5.70:1 통과 | 4.88:1 통과 | 상태 레이블 |
| `error` / `surface` | 4.5:1 | 6.08:1 통과 | 6.09:1 통과 | 컴포넌트 스와치 |
| `error` / `surface-raised` | 4.5:1 | 6.57:1 통과 | 5.34:1 통과 | 상태 문구 |
| `info` / `info-subtle` | 4.5:1 | 5.41:1 통과 | 5.55:1 통과 | 상태 레이블 |
| `info` / `surface-raised` | 4.5:1 | 6.10:1 통과 | 6.11:1 통과 | 상태 문구 |
| `on-danger` / `danger-hover` | 4.5:1 | 7.95:1 통과 | 8.32:1 통과 | 컴포넌트 스와치 |
| `on-danger` / `danger-pressed` | 4.5:1 | 9.68:1 통과 | 5.78:1 통과 | 컴포넌트 스와치 |
| `on-danger` / `error` | 4.5:1 | 6.57:1 통과 | 6.76:1 통과 | 컴포넌트 스와치 |
| `on-primary` / `primary` | 4.5:1 | 11.50:1 통과 | 8.90:1 통과 | 컴포넌트 스와치 |
| `on-primary` / `primary-hover` | 4.5:1 | 8.53:1 통과 | 10.55:1 통과 | 컴포넌트 스와치 |
| `on-primary` / `primary-pressed` | 4.5:1 | 13.93:1 통과 | 6.75:1 통과 | 컴포넌트 스와치 |
| `on-tooltip` / `tooltip-bg` | 4.5:1 | 11.50:1 통과 | 15.93:1 통과 | 컴포넌트 스와치 |
| `primary` / `bg` | 4.5:1 | 11.50:1 통과 | 8.90:1 통과 | 라이트 워드마크 대체 기준 |
| `primary` / `surface` | 4.5:1 | 10.63:1 통과 | 8.02:1 통과 | 컴포넌트 스와치 |
| `primary` / `surface-hover` | 4.5:1 | 9.86:1 통과 | 5.95:1 통과 | 서비스 카드 링크 호버 |
| `primary` / `surface-pressed` | 4.5:1 | 9.13:1 통과 | 5.58:1 통과 | 서비스 카드 링크 눌림 |
| `primary` / `surface-raised` | 4.5:1 | 11.50:1 통과 | 7.04:1 통과 | 푸터 링크·서비스 카드 |
| `success` / `success-subtle` | 4.5:1 | 4.75:1 통과 | 5.70:1 통과 | 상태 레이블 |
| `success` / `surface-raised` | 4.5:1 | 5.33:1 통과 | 6.69:1 통과 | 상태 문구 |
| `text` / `bg` | 4.5:1 | 17.28:1 통과 | 15.93:1 통과 | 본문·제목 |
| `text` / `error-subtle` | 4.5:1 | 14.98:1 통과 | 11.51:1 통과 | 컴포넌트 스와치 |
| `text` / `info-subtle` | 4.5:1 | 15.32:1 통과 | 11.46:1 통과 | 컴포넌트 스와치 |
| `text` / `success-subtle` | 4.5:1 | 15.40:1 통과 | 10.74:1 통과 | 컴포넌트 스와치 |
| `text` / `surface` | 4.5:1 | 15.98:1 통과 | 14.35:1 통과 | 본문·제목 |
| `text` / `surface-hover` | 4.5:1 | 14.82:1 통과 | 10.65:1 통과 | 본문·제목 |
| `text` / `surface-pressed` | 4.5:1 | 13.72:1 통과 | 10.00:1 통과 | 본문·제목 |
| `text` / `surface-raised` | 4.5:1 | 17.28:1 통과 | 12.60:1 통과 | 본문·제목 |
| `text` / `warning-subtle` | 4.5:1 | 16.35:1 통과 | 10.92:1 통과 | 컴포넌트 스와치 |
| `text-muted` / `bg` | 4.5:1 | 7.44:1 통과 | 7.68:1 통과 | 보조 문구 |
| `text-muted` / `info-subtle` | 4.5:1 | 6.59:1 통과 | 5.52:1 통과 | 컴포넌트 스와치 |
| `text-muted` / `surface` | 4.5:1 | 6.88:1 통과 | 6.92:1 통과 | 보조 문구 |
| `text-muted` / `surface-hover` | 4.5:1 | 6.38:1 통과 | 5.13:1 통과 | 보조 문구 |
| `text-muted` / `surface-pressed` | 4.5:1 | 5.91:1 통과 | 4.82:1 통과 | 보조 문구 |
| `text-muted` / `surface-raised` | 4.5:1 | 7.44:1 통과 | 6.07:1 통과 | 보조 문구 |
| `warning` / `surface-raised` | 4.5:1 | 5.93:1 통과 | 7.48:1 통과 | 상태 문구 |
| `warning` / `warning-subtle` | 4.5:1 | 5.61:1 통과 | 6.48:1 통과 | 상태 레이블 |
| `warning` / `surface` | 4.5:1 | 5.48:1 통과 | 8.52:1 통과 | 상태 문구(surface 위) |
| `warning` / `bg` | 4.5:1 | 5.93:1 통과 | 9.46:1 통과 | 상태 문구 |
| `warning` / `surface-hover` | 4.5:1 | 5.08:1 통과 | 6.32:1 통과 | 상태 문구 |
| `warning` / `surface-pressed` | 4.5:1 | 4.70:1 통과 | 5.93:1 통과 | 상태 문구 |
| `bg` / `border-strong` | 3:1 | 3.91:1 통과 | 5.12:1 통과 | 선택 표시 |
| `border-strong` / `bg` | 3:1 | 3.91:1 통과 | 5.12:1 통과 | 입력 경계 · 선택 컨트롤의 경계 · 필수 경계 |
| `border-strong` / `surface` | 3:1 | 3.61:1 통과 | 4.61:1 통과 | 버튼의 경계 · 입력 경계 · 드롭다운 경계 · 선택 컨트롤의 경계 · 세그먼트 경계 · 메뉴 경계 · 런처 카드 경계 · 필수 경계 |
| `border-strong` / `surface-hover` | 3:1 | 3.35:1 통과 | 3.42:1 통과 | 입력 경계 · 선택 컨트롤의 경계 · 버튼의 경계 · 필수 경계 |
| `border-strong` / `surface-raised` | 3:1 | 3.91:1 통과 | 4.05:1 통과 | 진행 바 경계 · 버튼의 경계 · 입력 경계 · 권한 선택 경계 · 필수 경계 |
| `border-strong` / `surface-pressed` | 3:1 | 3.10:1 통과 | 3.21:1 통과 | Secondary·Icon button 눌림 경계 · 필수 경계 |
| `danger-hover` / `surface` | 3:1 | 7.35:1 통과 | 7.50:1 통과 | 버튼의 경계 |
| `danger-pressed` / `surface` | 3:1 | 8.95:1 통과 | 5.21:1 통과 | 버튼의 경계 |
| `error` / `bg` | 3:1 | 6.57:1 통과 | 6.76:1 통과 | 입력 경계 |
| `error` / `error-subtle` | 3:1 | 5.70:1 통과 | 4.88:1 통과 | 안내 아이콘 |
| `error` / `surface` | 3:1 | 6.08:1 통과 | 6.09:1 통과 | 버튼의 경계 · 입력 경계 |
| `error` / `surface-pressed` | 3:1 | 5.22:1 통과 | 4.24:1 통과 | 진행 막대 |
| `error` / `surface-raised` | 3:1 | 6.57:1 통과 | 5.34:1 통과 | 버튼의 경계 · 입력 경계 · 위험 버튼·오류 경계 |
| `focus` / `bg` | 3:1 | 6.10:1 통과 | 8.90:1 통과 | 포커스 링 인접 바탕 |
| `focus` / `surface` | 3:1 | 5.64:1 통과 | 8.02:1 통과 | 2px 바깥 포커스 · 포커스 링 인접 바탕 |
| `focus` / `surface-hover` | 3:1 | 5.23:1 통과 | 5.95:1 통과 | 포커스 링 인접 바탕 |
| `focus` / `surface-raised` | 3:1 | 6.10:1 통과 | 7.04:1 통과 | 2px 바깥 포커스 · 포커스 링 인접 바탕 |
| `info` / `info-subtle` | 3:1 | 5.41:1 통과 | 5.55:1 통과 | 안내 아이콘 |
| `on-danger` / `error` | 3:1 | 6.57:1 통과 | 6.76:1 통과 | 컴포넌트 스와치 |
| `on-primary` / `border-strong` | 3:1 | 3.91:1 통과 | 5.12:1 통과 | 스위치 손잡이 |
| `on-primary` / `primary` | 3:1 | 11.50:1 통과 | 8.90:1 통과 | 선택 표시 · 스위치 손잡이 |
| `on-primary` / `primary-pressed` | 3:1 | 13.93:1 통과 | 6.75:1 통과 | 선택 표시 · 스위치 손잡이 |
| `primary` / `bg` | 3:1 | 11.50:1 통과 | 8.90:1 통과 | 선택 세그먼트 · 브랜드·선택 UI |
| `primary` / `info-subtle` | 3:1 | 10.19:1 통과 | 6.40:1 통과 | 선택 표시 |
| `primary` / `surface` | 3:1 | 10.63:1 통과 | 8.02:1 통과 | 버튼의 경계 · 선택 컨트롤의 경계 · 현재 탭 밑줄 |
| `primary` / `surface-hover` | 3:1 | 9.86:1 통과 | 5.95:1 통과 | 컴포넌트 스와치 |
| `primary` / `surface-pressed` | 3:1 | 9.13:1 통과 | 5.58:1 통과 | 진행 막대 |
| `primary` / `surface-raised` | 3:1 | 11.50:1 통과 | 7.04:1 통과 | 버튼의 경계 · 브랜드 버튼 경계 |
| `primary-hover` / `surface` | 3:1 | 7.89:1 통과 | 9.51:1 통과 | 버튼의 경계 |
| `primary-pressed` / `bg` | 3:1 | 13.93:1 통과 | 6.75:1 통과 | 선택 세그먼트 |
| `primary-pressed` / `surface` | 3:1 | 12.87:1 통과 | 6.08:1 통과 | 버튼의 경계 · 선택 컨트롤의 경계 |
| `success` / `success-subtle` | 3:1 | 4.75:1 통과 | 5.70:1 통과 | 안내 아이콘 |
| `success` / `surface-pressed` | 3:1 | 4.23:1 통과 | 5.30:1 통과 | 진행 막대 |
| `text` / `bg` | 3:1 | 17.28:1 통과 | 15.93:1 통과 | 큰 텍스트 |
| `text` / `error-subtle` | 3:1 | 14.98:1 통과 | 11.51:1 통과 | 컴포넌트 스와치 |
| `text` / `info-subtle` | 3:1 | 15.32:1 통과 | 11.46:1 통과 | 컴포넌트 스와치 |
| `text` / `success-subtle` | 3:1 | 15.40:1 통과 | 10.74:1 통과 | 컴포넌트 스와치 |
| `text` / `surface` | 3:1 | 15.98:1 통과 | 14.35:1 통과 | 컴포넌트 스와치 |
| `text` / `surface-hover` | 3:1 | 14.82:1 통과 | 10.65:1 통과 | 컴포넌트 스와치 |
| `text` / `surface-pressed` | 3:1 | 13.72:1 통과 | 10.00:1 통과 | 컴포넌트 스와치 |
| `text` / `surface-raised` | 3:1 | 17.28:1 통과 | 12.60:1 통과 | 컴포넌트 스와치 |
| `text-muted` / `bg` | 3:1 | 7.44:1 통과 | 7.68:1 통과 | 스위치 손잡이 |
| `text-muted` / `surface` | 3:1 | 6.88:1 통과 | 6.92:1 통과 | 컴포넌트 스와치 |
| `text-muted` / `surface-hover` | 3:1 | 6.38:1 통과 | 5.13:1 통과 | 스위치 손잡이 |
| `text-muted` / `surface-raised` | 3:1 | 7.44:1 통과 | 6.07:1 통과 | 컴포넌트 스와치 |
| `warning` / `warning-subtle` | 3:1 | 5.61:1 통과 | 6.48:1 통과 | 안내 아이콘 |

### 장식 역할 참고값

이 값은 장식용 경계와 보조 색의 사용 범위를 정하는 데 참고한다. 기능 경계에는 `border-strong`, 작은 레이블에는 검증 표의 텍스트 색을 적용한다.

| 전경 / 배경 | 참고 기준 | 라이트 | 다크 | 역할 |
| --- | --- | --- | --- | --- |
| `accent` / `bg` | 3:1 | 2.31:1 미달 | 10.09:1 통과 | 금색 포인트 · 장식 |
| `border` / `bg` | 3:1 | 1.39:1 미달 | 1.54:1 미달 | 구분선 · 장식 |
| `border` / `surface` | 3:1 | 1.29:1 미달 | 1.39:1 미달 | 구분선 · 장식 |
| `secondary` / `surface` | 4.5:1 | 4.73:1 통과 | 5.00:1 통과 | 보조 그래픽 전용 · 텍스트 금지 |
| `secondary` / `surface-raised` | 4.5:1 | 5.12:1 통과 | 4.39:1 미달(텍스트) / 3:1 통과(그래픽) | 그래픽 전용 · 텍스트 금지 |
| `secondary` / `surface-hover` | 4.5:1 | 4.39:1 미달(텍스트) / 3:1 통과(그래픽) | 3.71:1 미달(텍스트) / 3:1 통과(그래픽) | 그래픽 전용 · 텍스트 금지 |
| `secondary` / `surface-pressed` | 4.5:1 | 4.06:1 미달(텍스트) / 3:1 통과(그래픽) | 3.48:1 미달(텍스트) / 3:1 통과(그래픽) | 그래픽 전용 · 텍스트 금지 |

## 설계 봇 전달용 컴포넌트·토큰 목록

색상은 각 줄에서 `Light / Dark` 순으로 읽는다. JSON은 DTCG 2025.10 형식에 가깝게 구성했다. 색상 그룹은 `color.light` / `color.dark`, 그 외 그룹은 `typography`, `font`, `spacing`, `radius`, `shadow`, `grid`, `motion`, `control`이다. [tokens.json](tokens.json) · [DTCG Format Module](https://www.designtokens.org/TR/2025.10/format/)

```text
bg  #FFFFFF / #0B1220
surface  #F4F6FA / #141D2E
surface-raised  #FFFFFF / #1C283C
surface-hover  #E8EEF7 / #25344D
surface-pressed  #DCE6F4 / #2B3851
text  #0F1B2D / #E8EDF5
text-muted  #4A5668 / #9AA7BA
border  #D5DBE5 / #2A364B
border-strong  #738298 / #7487A3
primary  #1E3A5F / #8DB4F5
on-primary  #FFFFFF / #0B1220
primary-hover  #284E7A / #A3C4FA
primary-pressed  #172D49 / #749CE0
secondary  #3E6FB0 / #5B8DD6
accent  #D4A24C / #E3B866
focus  #1D5FBF / #8DB4F5
success  #1E7A4C / #4CC38A
success-subtle  #E8F5ED / #17392F
warning  #8C5900 / #E5B03C
warning-subtle  #FFF8EA / #3C3020
error  #B42318 / #F2766B
error-subtle  #FCEBE9 / #422630
info  #1D5FBF / #6AA8FF
info-subtle  #E9F2FF / #172F50
on-danger  #FFFFFF / #0B1220
danger-hover  #9D1F16 / #FF8C83
danger-pressed  #861A11 / #E16B62
overlay  #0B122066 / #00000080
scrim  #0B122099 / #000000B3
tooltip-bg  #1E3A5F / #E8EDF5
on-tooltip  #FFFFFF / #0B1220
```

- **동작** · Button, Icon button
- **입력** · Text field, Search field, Select / Dropdown, Checkbox, Radio, Toggle, Segmented control
- **탐색** · Tabs, Breadcrumb, Drive navigation, Badge / Tag, Avatar, Tooltip, Menu
- **피드백** · Toast / Snackbar, Inline alert / Banner, Empty state, Skeleton / Loading, Progress
- **오버레이** · Dialog / Modal, Share dialog / Member sharing page, Bottom sheet
- **데이터** · Pagination, Admin table, File list row, File grid card
- **공통 UI** · Service card, Common header, Common footer

## 산출물

- [FigCraft 원본](design-system.figcraft) · [토큰 JSON](tokens.json)
- 아래 PNG는 각 그룹의 라이트 및 다크 내보내기다.

- foundations · [Light](exports/foundations-light.png) / [Dark](exports/foundations-dark.png)
- brand-assets · [Light](exports/brand-assets-light.png) / [Dark](exports/brand-assets-dark.png)
- icons · [Light](exports/icons-light.png) / [Dark](exports/icons-dark.png)
- components-buttons · [Light](exports/components-buttons-light.png) / [Dark](exports/components-buttons-dark.png)
- components-inputs · [Light](exports/components-inputs-light.png) / [Dark](exports/components-inputs-dark.png)
- components-navigation · [Light](exports/components-navigation-light.png) / [Dark](exports/components-navigation-dark.png)
- components-feedback · [Light](exports/components-feedback-light.png) / [Dark](exports/components-feedback-dark.png)
- components-overlays · [Light](exports/components-overlays-light.png) / [Dark](exports/components-overlays-dark.png)
- components-data · [Light](exports/components-data-light.png) / [Dark](exports/components-data-dark.png)
- components-shell · [Light](exports/components-shell-light.png) / [Dark](exports/components-shell-dark.png)
- contrast · [Light](exports/contrast-light.png) / [Dark](exports/contrast-dark.png)

### Lucide 출처 고지

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## v0.2 검수 반영

NARU-93 · DES-002 Deep Ink (먹빛 나루). 아래 토큰·대비·구성 지침을 v0.2 설계와 구현에 적용한다. 본문 토큰 표, 대비 표, 인벤토리, `tokens.json`도 같은 값으로 맞춰 두었다.

### 컬러 토큰

| 토큰 | Light v0.1 → v0.2 | Dark v0.2 | 용도 |
| --- | --- | --- | --- |
| `border-strong` | `#79889E` → `#738298` | `#7487A3` | 입력·컨트롤의 필수 경계. Secondary 버튼과 Icon button의 눌림 경계에도 적용한다. |
| `warning` | `#9A6700` → `#8C5900` | `#E5B03C` | 주의 텍스트·아이콘. Badge 및 Inline alert의 `warning-subtle`, 독립 상태 문구의 `surface-raised`, 검수에서 다룬 `surface`에 사용한다. |
| `secondary` | `#3E6FB0` | `#5B8DD6` | 보조 그래픽·진행 표시 전용. 텍스트 금지. 레이블은 `primary`, `text` 또는 `text-muted`를 사용한다. |

두 모드의 기존 토큰 이름을 사용한다. Deep Ink `primary`(`#1E3A5F` / `#8DB4F5`), `accent`(`#D4A24C` / `#E3B866`), IBM Plex Sans KR + IBM Plex Sans, 아치와 수면선 로고를 적용한다.

### 대비 검증

WCAG 상대 휘도로 측정하고 반올림 전 값으로 판정한다. 일반 텍스트는 4.5:1 이상, 큰 텍스트·UI·포커스 링·필수 경계는 3:1 이상이다. 표는 소수점 넷째 자리까지 표기한다.

| 전경 / 배경 | Light | Dark | 기준·판정 |
| --- | ---: | ---: | --- |
| `border-strong` / `bg` | 3.9067:1 | 5.1150:1 | UI 3:1 통과 |
| `border-strong` / `surface` | 3.6108:1 | 4.6083:1 | UI 3:1 통과 |
| `border-strong` / `surface-raised` | 3.9067:1 | 4.0455:1 | UI 3:1 통과 |
| `border-strong` / `surface-hover` | 3.3493:1 | 3.4210:1 | UI 3:1 통과 |
| `border-strong` / `surface-pressed` | 3.1008:1 | 3.2101:1 | UI 3:1 통과 |
| `warning` / `surface-raised` | 5.9254:1 | 7.4795:1 | 상태 문구, 4.5:1 통과 |
| `warning` / `warning-subtle` | 5.6058:1 | 6.4844:1 | Badge 레이블·Inline alert 제목과 아이콘, 4.5:1 통과 |
| `warning` / `surface` | 5.4766:1 | 8.5201:1 | 검수 대상 일반 텍스트, 4.5:1 통과 |
| `warning` / `bg` | 5.9254:1 | 9.4569:1 | 일반 텍스트 4.5:1 통과 |
| `warning` / `surface-hover` | 5.0801:1 | 6.3249:1 | 일반 텍스트 4.5:1 통과 |
| `warning` / `surface-pressed` | 4.7032:1 | 5.9350:1 | 일반 텍스트 4.5:1 통과 |

아래는 그래픽 전용 `secondary` 참고값이다. 다크 `surface-raised`의 4.3901:1과 hover·pressed 쌍은 UI 그래픽 3:1을 충족한다. 모든 배경에서 `secondary`를 텍스트에 사용하는 것은 금지한다.

| 전경 / 배경 | Light | Dark |
| --- | ---: | ---: |
| `secondary` / `surface` | 4.7276:1 | 5.0009:1 |
| `secondary` / `surface-raised` | 5.1151:1 | 4.3901:1 |
| `secondary` / `surface-hover` | 4.3853:1 | 3.7124:1 |
| `secondary` / `surface-pressed` | 4.0599:1 | 3.4835:1 |

### 컴포넌트 인벤토리와 적용 지침

| 보드 | 추가·수정한 구성 | 적용 |
| --- | --- | --- |
| Shell | Common header · `desktop-guest/default`, `mobile-guest/default`, `mobile-guest/open` | WF-08 주석 ⑤. 데스크톱에는 로고, 서비스 전환, 문서, 저장소, 로그인 버튼을 표시한다. 모바일 기본 헤더에는 로고, 로그인, 메뉴 버튼을 두고 드로어에 서비스 전환과 문서·저장소를 둔다. 로고·서비스 전환·카테고리·로그인은 WF-01로 이동한다(DEC-071·076). |
| Navigation | Drive navigation · `desktop/mobile` × `drive/trash` | WF-05·06. 데스크톱 사이드바와 모바일 드라이브 메뉴 안에 `내 드라이브`와 `휴지통`을 둔다. 현재 위치는 시각 표시와 `aria-current="page"`를 함께 사용한다. WF-06은 메뉴의 `휴지통`으로 진입한다(DEC-064). |
| Overlays / Data | Dialog / Folder workflows · 폴더 만들기, 이름 변경, 저장 폴더 선택, 이동 대상 선택. File list row · `folder/selected` | WF-05 입력 대화상자는 Text field와 취소·확인을 조합한다. 빈 이름과 같은 위치의 중복 이름은 입력 오류로 안내한다. WF-03 및 WF-05 선택 대화상자는 folder 행과 selected 체크를 조합한다. 취소 시 기존 상태를 유지하고 확인 시 선택을 반영한다. 이동할 때 자기 자신과 하위 폴더는 대상에서 제외한다. 대화상자를 닫으면 열린 자리의 조작 버튼으로 포커스를 돌려준다. |
| Shell / Overlays | Member sharing page · `desktop/mobile`. 기존 Share dialog는 모달 변형으로 사용 | WF-07 독립 페이지에 공통 헤더·푸터, 전체 이메일을 통한 활동 회원 조회, 검색 결과, 보기·편집 Radio, 보기일 때의 다운로드 허용, 공유와 공유 취소를 둔다. 두 동작 후 WF-07에서 회원 목록을 갱신한다(DEC-065). WF-05 상태 D의 모달은 링크 공유 설정에 사용한다. |

WF-03에서 저장 폴더를 변경하면 이후 결과물에만 새 폴더를 적용한다. WF-05에서 항목을 삭제하면 드라이브 목록에 머문다. WF-06은 드라이브 메뉴에서 진입한다.

### 설계 봇 전달 목록

- FigCraft Deep Ink의 Light/Dark 모드와 `tokens.json`에서 같은 토큰 이름을 사용한다. v0.2 라이트 값은 `border-strong: #738298`, `warning: #8C5900`이며 새 토큰은 없다.
- Secondary 버튼 및 Icon button의 눌림 경계는 `border-strong` / `surface-pressed` 조합을 사용한다. 그래픽 `secondary`는 텍스트에 사용하지 않는다.
- WF-08은 Common header guest, WF-05·06은 Drive navigation, WF-03·05는 Dialog / Folder workflows와 File list row, WF-07은 Member sharing page를 참조한다.
- FigCraft의 Foundations, Contrast, Buttons, Inputs, Feedback, Navigation, Overlays, Data, Shell 예시를 각 모드의 구현 검토에 사용한다.
