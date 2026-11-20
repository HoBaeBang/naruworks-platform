# WF-01~04 화면 시안 · 승인③

공식 기준은 develop `4b66d1d`의 기획 v1.0이다. FigCraft에서 [와이어프레임 원본](../../01-planning/wireframe/WF.figcraft)의 WF-01~04 화면, 상태, 주석과 [디자인 시스템 v0.3](../design-system/design-system.figcraft)의 Deep Ink 컬렉션, 브랜드 자산, 아이콘, 컴포넌트를 확인했다. `4b66d1d`와 DS 기준 커밋 `04bc090`에 대한 로컬 파일의 Git 일치 여부는 [미확인]이다.

[화면 FigCraft](screens-wf01-04.figcraft)에는 화면별 4페이지와 로컬 Deep Ink 자산이 있다. 기본 16개와 상태 40개를 합쳐 56개이며 모든 상태를 데스크톱·모바일 × 라이트·다크로 그렸다. 표의 PNG 파일명은 같은 이름의 아트보드에 대응한다. 상태 S의 출처는 두 화면의 표에 별도로 표시했다.

## 공통 화면 규칙

- 데스크톱 1440px, 12열, 여백 32px, 거터 24px. 모바일 360px, 4열, 여백·거터 16px. 버튼과 메뉴 행의 모바일 터치 영역은 44px 이상으로 잡았다.
- WF-01은 공통 푸터를 사용한다. WF-02~04는 일반 회원용 공통 헤더와 푸터를 사용한다. 모바일 드로어 변형은 FigCraft의 화면 컴포넌트 페이지에 들어 있다. 드로어에는 서비스 전환, 카테고리, 프로필, 로그아웃이 있으며 숨김 상태에 맞게 서비스 항목을 조정한다.
- 공통 헤더의 로고는 WF-02, 카테고리는 WF-02의 각 섹션으로 이동한다. Litpage는 처음이면 WF-03, 저장 폴더를 이미 선택했으면 WF-04로 이동한다. 나루 드라이브는 WF-05, 프로필은 WF-15, 로그아웃은 WF-01로 이어지며 Litpage도 함께 종료된다. 외부 연동과 인증 조건, 범위 밖 화면은 동선 주석으로 다뤘다. FigCraft에는 범위 안의 대표 이동만 연결했다.
- 푸터는 이용약관·개인정보처리방침을 새 창으로 표시하는 한·영 문서, 공개 문의 주소 `aslanhobae@gmail.com`, 같은 창의 라이선스 고지, `Dev. Aslan0` 표기를 전제로 한다. 문의 메일의 `mailto:` 연결과 사업자·운영자 정보 표시(Q-081)는 [미확인]이다.
- 모바일 재배치는 NFR-USAB-001을 바탕으로 DS의 모바일 변형을 적용한 시안이다. 헤더·푸터와 화면별 모바일 차이의 기획 확정 여부는 [미확인]이다.
- `pending planning change (GAP-017)` 해당 없음. WF-01~04 모바일의 대상 썸네일 미리보기는 없다.
- `pending planning change (DEC-101)` 테마 저장 단위는 회원 계정이라는 미커밋 메모가 있다. 선택기 존재 여부·위치는 [미확인]이다. 라이트·다크는 디자이너가 비교하는 시안 두 종류다.
- 로딩 상태는 [미확인]이다. 표시 문구는 한국어 시안 기준이다. 예시 문구와 문구 미확정 상태는 해당 화면과 FigCraft 주석에 표시했다.

## WF-01 · 로그인

**FR / AC / UF**  
FR-AUTH-001, FR-AUTH-004, FR-AUTH-005 · AC-FR-AUTH-001-01~03, AC-FR-AUTH-004-01·02·03, AC-FR-AUTH-005-01, AC-NFR-I18N-002-01, AC-NFR-SEC-004-01 · UF-01.

| 상태 | 출처 | 프레임 및 PNG |
| --- | --- | --- |
| 기본 · Google 가입·로그인 | WF v1.0 | [데스크톱 라이트](exports/WF-01-login-desktop-light.png) · [데스크톱 다크](exports/WF-01-login-desktop-dark.png) · [모바일 라이트](exports/WF-01-login-mobile-light.png) · [모바일 다크](exports/WF-01-login-mobile-dark.png) |
| A · Google 인증 취소·실패 | WF v1.0 | [데스크톱 라이트](exports/WF-01-login-desktop-light-state-A.png) · [데스크톱 다크](exports/WF-01-login-desktop-dark-state-A.png) · [모바일 라이트](exports/WF-01-login-mobile-light-state-A.png) · [모바일 다크](exports/WF-01-login-mobile-dark-state-A.png) |
| S · 정지 계정 | 이번 시안 추가 | [데스크톱 라이트](exports/WF-01-login-desktop-light-state-S.png) · [데스크톱 다크](exports/WF-01-login-desktop-dark-state-S.png) · [모바일 라이트](exports/WF-01-login-mobile-light-state-S.png) · [모바일 다크](exports/WF-01-login-mobile-dark-state-S.png) |

- 기본은 Google 인증을 거쳐 기존 회원과 승인 없는 즉시 가입 회원이 WF-02로 이어진다. 30일 안 재가입 복구 안내는 WF-02 상태 C에서 표시한다. 상태 A의 재시도는 같은 「Google로 로그인」 버튼을 사용한다.
- 와이어프레임의 제목·안내·버튼을 Deep Ink 로고가 있는 로그인 그룹으로 배치했다. 승인된 DS에 Google 공식 마크 자산이 없어 텍스트 레이블의 primary 버튼을 사용했다.
- 상태 S는 WF-01 위에서 검토하는 시안이다. 공식 기획 v1.0의 정지 계정 로그인 동선은 WF-10 로그인 차단 안내다. `pending planning change (정지 계정)`에는 토큰 갱신 시에도 차단한다는 메모가 있으며, 갱신 차단의 UI 표현과 이후 동선은 [미확인]이다.
- 열린 질문 [미확인] — 로그인 전 언어의 보관 위치, 이미 로그인한 사용자의 WF-01 접근, 재가입 30일 경과 시 안내, 인증 로딩. 언어 설정 전 기기 언어가 영어면 영어, 그 외는 한국어라는 기준을 주석으로 적용했다.
- DS · Button primary lg, Common footer, Inline alert, Deep Ink 가로형 로고.

## WF-02 · 서비스 목록 홈

**FR / AC / UF**  
FR-HOME-001, FR-HOME-002, FR-AUTH-004, FR-SHELL-001·002 · AC-FR-HOME-001-01·02, AC-FR-HOME-002-01·02, AC-FR-AUTH-004-01·03, AC-FR-ADM-001-03, AC-FR-ADM-003-02 · UF-01, UF-02.

| 상태 | 출처 | 프레임 및 PNG |
| --- | --- | --- |
| 기본 · 문서·저장소 | WF v1.0 | [데스크톱 라이트](exports/WF-02-home-desktop-light.png) · [데스크톱 다크](exports/WF-02-home-desktop-dark.png) · [모바일 라이트](exports/WF-02-home-mobile-light.png) · [모바일 다크](exports/WF-02-home-mobile-dark.png) |
| A · 빈 카테고리 | WF v1.0 | [데스크톱 라이트](exports/WF-02-home-desktop-light-state-A.png) · [데스크톱 다크](exports/WF-02-home-desktop-dark-state-A.png) · [모바일 라이트](exports/WF-02-home-mobile-light-state-A.png) · [모바일 다크](exports/WF-02-home-mobile-dark-state-A.png) |
| B · 모든 오픈소스 숨김 | WF v1.0 | [데스크톱 라이트](exports/WF-02-home-desktop-light-state-B.png) · [데스크톱 다크](exports/WF-02-home-desktop-dark-state-B.png) · [모바일 라이트](exports/WF-02-home-mobile-light-state-B.png) · [모바일 다크](exports/WF-02-home-mobile-dark-state-B.png) |
| C · 30일 안 재가입 복구 | WF v1.0 | [데스크톱 라이트](exports/WF-02-home-desktop-light-state-C.png) · [데스크톱 다크](exports/WF-02-home-desktop-dark-state-C.png) · [모바일 라이트](exports/WF-02-home-mobile-light-state-C.png) · [모바일 다크](exports/WF-02-home-mobile-dark-state-C.png) |
| D · 오픈소스 라이선스 고지 | WF v1.0 | [데스크톱 라이트](exports/WF-02-home-desktop-light-state-D.png) · [데스크톱 다크](exports/WF-02-home-desktop-dark-state-D.png) · [모바일 라이트](exports/WF-02-home-mobile-light-state-D.png) · [모바일 다크](exports/WF-02-home-mobile-dark-state-D.png) |

- 기본은 문서의 Litpage 카드와 저장소의 나루 드라이브 카드다. 상태 A는 노출 서비스가 없는 문서 카테고리의 빈 상태를 보여 준다. 상태 B는 오픈소스가 전부 숨겨진 예시로 나루 드라이브만 노출한다. 일반 회원이 관리 URL에 직접 접근하면 안내 없이 이 홈으로 돌아오는 동선이다.
- 카드 설명은 서비스 종류로 채웠다. DS의 문서·드라이브 아이콘으로 카드를 구분했다. 상태 A는 Empty state의 파일 올리기 동작을 덜어내고 빈 카테고리 안내에 맞췄다. 상태 B에서는 문서 카테고리 항목도 정리했다.
- 상태 C의 복구 안내와 닫기 문구, 상태 D의 라이선스 본문은 [문구 미확정]이다. 같은 창 Dialog를 사용했으며 닫으면 WF-02에 머문다.
- 열린 질문 [미확인] — 카드 설명·아이콘 확정, 서비스·카테고리 이름 번역, 복구 안내·닫기 문구, 라이선스 고지 본문과 번역 범위.
- DS · Common header/footer, Service card, Empty state, Dialog/Modal, Button, 커스텀 아이콘.

## WF-03 · 저장 폴더 선택

**FR / AC / UF**  
FR-OSS-002 · AC-FR-OSS-002-01~04 · UF-02.

| 상태 | 출처 | 프레임 및 PNG |
| --- | --- | --- |
| 기본 · 첫 진입 | WF v1.0 | [데스크톱 라이트](exports/WF-03-save-folder-desktop-light.png) · [데스크톱 다크](exports/WF-03-save-folder-desktop-dark.png) · [모바일 라이트](exports/WF-03-save-folder-mobile-light.png) · [모바일 다크](exports/WF-03-save-folder-mobile-dark.png) |
| A · 저장 폴더 변경 재사용 | WF v1.0 | [데스크톱 라이트](exports/WF-03-save-folder-desktop-light-state-A.png) · [데스크톱 다크](exports/WF-03-save-folder-desktop-dark-state-A.png) · [모바일 라이트](exports/WF-03-save-folder-mobile-light-state-A.png) · [모바일 다크](exports/WF-03-save-folder-mobile-dark-state-A.png) |

- 첫 진입의 기본값은 `/litpage`다. 목록에서 고르면 선택 칸에 반영하는 동선이다. 취소하면 시작하지 않고 WF-02, 확인하면 WF-04로 이동한다.
- 상태 A는 DEC-063의 화면 재사용이다. 확인하면 이후 결과물만 새 폴더에 저장하고 기존 결과물은 그대로 유지한다. 취소하면 기존 설정을 유지한다. 둘 다 WF-04로 복귀한다.
- 와이어프레임의 폴더 목록을 File list row로 펼쳐 표시했다. 선택 표시를 넣고 목록 예시는 평면으로 배치했다. 기본 폴더 부재는 예시 안내로 표시했다.
- 열린 질문 [미확인] — 저장 폴더 직접 입력·검증, 계층 표현, 생성 UI, 빈 목록, 확인 실패, 대상 서비스 이름을 별도 표시할지 여부. 선택 표시와 예시 경로는 시안에 포함했다.
- DS · Common header/footer, Text field, File list row, Inline alert, Button, 폴더·확인 아이콘.

## WF-04 · Litpage

**FR / AC / UF**  
FR-OSS-001, FR-OSS-003, FR-OSS-002, FR-DRV-005(문서 열기 도착 참조) · AC-FR-OSS-001-01·02, AC-FR-OSS-003-01·02 · UF-02.

| 상태 | 출처 | 프레임 및 PNG |
| --- | --- | --- |
| 기본 · 작업 영역 | WF v1.0 | [데스크톱 라이트](exports/WF-04-litpage-desktop-light.png) · [데스크톱 다크](exports/WF-04-litpage-desktop-dark.png) · [모바일 라이트](exports/WF-04-litpage-mobile-light.png) · [모바일 다크](exports/WF-04-litpage-mobile-dark.png) |
| A · 자동 저장 실패 | WF v1.0 | [데스크톱 라이트](exports/WF-04-litpage-desktop-light-state-A.png) · [데스크톱 다크](exports/WF-04-litpage-desktop-dark-state-A.png) · [모바일 라이트](exports/WF-04-litpage-mobile-light-state-A.png) · [모바일 다크](exports/WF-04-litpage-mobile-dark-state-A.png) |
| B · Litpage 진입 실패 | WF v1.0 | [데스크톱 라이트](exports/WF-04-litpage-desktop-light-state-B.png) · [데스크톱 다크](exports/WF-04-litpage-desktop-dark-state-B.png) · [모바일 라이트](exports/WF-04-litpage-mobile-light-state-B.png) · [모바일 다크](exports/WF-04-litpage-mobile-dark-state-B.png) |
| S · 정지 계정의 Litpage 진입 차단 | 이번 시안 추가 | [데스크톱 라이트](exports/WF-04-litpage-desktop-light-state-S.png) · [데스크톱 다크](exports/WF-04-litpage-desktop-dark-state-S.png) · [모바일 라이트](exports/WF-04-litpage-mobile-light-state-S.png) · [모바일 다크](exports/WF-04-litpage-mobile-dark-state-S.png) |

- 나루의 공통 헤더·푸터와 「저장 폴더 변경」을 두고 외부 작업 영역에는 라벨을 붙였다. 변경은 WF-03 상태 A를 재사용한다. WF-05에서 연 문서도 이 작업 영역에 도착한다. 작성·수정은 지정 폴더에 자동 저장하는 동선이며 Litpage 별도 가입 없이 이용한다.
- 상태 A는 작업 영역을 유지한 채 Toast로 저장 실패를 알린다. 상태 B는 작업 영역 자리에 진입 실패 예시를 두고 WF-02로 돌아가는 버튼을 제공한다.
- 상태 S는 `pending planning change (정지 계정)` 검토용 추가 상태다. 정지 회원의 Litpage 진입 차단을 표시했다. B·S는 편집 작업 영역이 열리기 전이므로 그 자리에 차단 안내를 두고 폴더 변경 동작을 생략했다.
- 열린 질문 [미확인] — 현재 폴더 표시, 자동 저장 성공 표시, 서비스 숨김 전용 차단과 일반 진입 실패의 구분, 결과물 저장 형식(설계 이관), 정지 계정 차단 뒤 도착 화면(WF-02·WF-10 등)과 토큰 갱신 차단의 관계.
- DS · Common header/footer, Button, Toast, Inline alert, 파일 문서 아이콘. 외부 앱 경계를 보여 주기 위해 토큰 기반의 라벨 있는 작업 영역을 구성했다.

## 디자인 시스템 v0.3 검수 반영

- [file-pdf.svg](../design-system/icons/file-pdf.svg) — Deep Ink의 페이지와 접힌 모서리를 살리고 PDF 글자 획을 직접 그렸다. 16·20·24px 갤러리와 기존 `icon/file-pdf` 컴포넌트 연결을 확인했다. 문서에 PDF 레이블 병기 규칙을 적용한다.
- [file-archive.svg](../design-system/icons/file-archive.svg) — 지퍼 눈금을 3개에서 2개로 줄이고 당김 손잡이와의 간격을 넓혔다. 기존 `icon/file-archive` 컴포넌트와 Icons 페이지에 반영했다.
- 두 SVG는 24×24 뷰박스, 최소 2px 여백, 1.75px 스트로크, `currentColor`, 라운드 캡·조인을 사용한다. [디자인 시스템 변경 기록](../design-system/design-system.md)에 v0.3 검수 내역을 기록했다.
- FigCraft의 컴포넌트 예제에서 연결된 v0.3 아이콘을 확인했다. PDF를 사용하는 데이터 컴포넌트 인스턴스는 갱신된 마스터를 참조한다. 라이트·다크 Icons 2개와 컴포넌트 PNG 14개를 같은 경로에 다시 내보냈다.

| 보드 | 라이트 | 다크 |
| --- | --- | --- |
| Icons | [라이트](../design-system/exports/icons-light.png) | [다크](../design-system/exports/icons-dark.png) |
| buttons | [라이트](../design-system/exports/components-buttons-light.png) | [다크](../design-system/exports/components-buttons-dark.png) |
| data | [라이트](../design-system/exports/components-data-light.png) | [다크](../design-system/exports/components-data-dark.png) |
| feedback | [라이트](../design-system/exports/components-feedback-light.png) | [다크](../design-system/exports/components-feedback-dark.png) |
| inputs | [라이트](../design-system/exports/components-inputs-light.png) | [다크](../design-system/exports/components-inputs-dark.png) |
| navigation | [라이트](../design-system/exports/components-navigation-light.png) | [다크](../design-system/exports/components-navigation-dark.png) |
| overlays | [라이트](../design-system/exports/components-overlays-light.png) | [다크](../design-system/exports/components-overlays-dark.png) |
| shell | [라이트](../design-system/exports/components-shell-light.png) | [다크](../design-system/exports/components-shell-dark.png) |

## 검수와 한계

- 화면 PNG 56개와 디자인 시스템 PNG 16개를 FigCraft MCP로 내보냈다. 모든 화면의 아트보드 크기·그리드·레이어 경계를 검사했고 데스크톱·모바일 상태를 샘플 렌더링해 배치를 확인했다.
- 토큰 값 기준으로 주요 텍스트·배경 조합을 점검했다. 기본 동작 버튼 글자 11.50:1 / 8.90:1, 오류 제목 5.70:1 / 4.88:1, 선택 행·카드의 필수 경계에 쓴 강한 테두리와 raised 표면 3.91:1 / 4.05:1(라이트 / 다크)이다. 실제 브라우저의 키보드 포커스, 모달 읽기 순서, 구현 접근성은 [미확인]이다.
- IBM Plex Sans KR과 IBM Plex Sans는 FigCraft 헤드리스 환경의 글꼴 검사에서 모두 미설치로 판정됐다. 시안 파일에 지정된 글꼴을 보존했으며 PNG에는 대체 글꼴이 쓰인다.
- 사용한 도구는 FigCraft MCP와 `apply_patch`다. 별도 권한 요청 없음.

---

# v2 — 승인③ 재작업 (WF-01~04)

v1 반려 사유: 데스크톱에서 내용이 왼쪽 좁은 열에만 몰리고 오른쪽이 비었다. v2는 레이아웃·위계·밀도를 다시 설계했다. v1 파일과 `exports/`의 v1 PNG는 비교용으로 그대로 둔다.

- FigCraft: [screens-wf01-04-v2.figcraft](screens-wf01-04-v2.figcraft) (페이지 4개 + 「v2 · 화면 부품」 + v1에서 가져온 DS 컴포넌트·아이콘 페이지). PNG 56장: `exports/v2/` (파일명 `WF-xx-…-{desktop|mobile}-{light|dark}[-state-X].png`).
- 기준: develop `4b66d1d` 기획 v1.0 + DEC-084·101·102. 테마 선택기 위치(Q-090)는 어디에도 그리지 않았다. 라이트·다크는 디자이너용 시안이다.
- 와이어프레임은 기능 범위의 기준이며 배치는 따르지 않았다(호배님 지시).
- 공통: 데스크톱 1440, 콘텐츠 최대폭을 화면별로 정해(WF-02 1200, WF-03 960) 가운데 정렬. 본문 배경 `surface`, 카드 `surface-raised`+`border`+그림자 1. 헤더 64·푸터는 전폭, 푸터 링크는 한 줄(데스크톱)·44px 행(모바일). 모바일 360, 터치 요소 44px 이상. 다크는 같은 변수(Deep Ink 컬렉션)의 Dark 모드로 전환해 라이트 색이 남지 않는다.
- 모바일 WF-03은 내용이 길어 프레임 높이를 1080으로 했다(전체 페이지 목업). 나머지는 812.

## 화면별

| 화면 | WF / FR·AC | 상태 | v1·와이어프레임과 다른 점(이유) |
| --- | --- | --- | --- |
| WF-01 로그인 | FR-AUTH-001·004·005 / AC-FR-AUTH-001-01~03, AC-FR-AUTH-005-01 | 기본, A 인증 취소·실패, S 정지 계정(시안 추가·pending planning, 공식 동선은 WF-10) | 화면을 좌(브랜드 패널 800px: 로고, 금색 룰, 아치·수면선 모티프) / 우(로그인 카드 448px) 2분할로 해 양쪽 모두 의미 있는 면이 되게 했다. 푸터만 늘어나고 본문이 한쪽으로 쏠리던 v1을 고쳤다. 모바일은 로고+카드 중앙 배치. 버튼은 텍스트 「Google로 로그인」. 오류는 카드 안 Inline alert(문구 [문구 미확정]). |
| WF-02 서비스 목록 홈 | FR-HOME-001·002, FR-AUTH-004, FR-SHELL-001·002 / AC-FR-HOME-001-01·02, AC-FR-HOME-002-01·02, AC-FR-AUTH-004-01·03, AC-FR-SHELL-002-04 | 기본, A 빈 카테고리, B 오픈소스 숨김, C 복구 안내(`[문구 미확정]`), D 라이선스 고지(`[문구 미확정]`) | 카테고리별 세로 목록 → 1200px 2열 그리드(문서 / 저장소)로 바꿨다. 카드는 아이콘·종류 배지·설명·구분선·「열기」로 위계를 주었다. A는 점선 빈 상태, B는 숨긴 카테고리와 헤더 「문서」를 제거하고 드라이브 카드를 폭 588 중앙 한 열로 배치. C·D는 `scrim` 위 대화상자. 모바일은 카드 1열 가로형. |
| WF-03 저장 폴더 선택 | FR-OSS-002 / AC-FR-OSS-002-01~04 | 기본(첫 진입, `/litpage`), A 변경 재사용 안내 | 단일 좁은 열 → 960px 카드 2패널(왼쪽 「선택한 저장 폴더」 필드·기본값 배지, 오른쪽 폴더 목록)+하단 동작 바. 취소→WF-02, 확인→WF-04(A는 취소·확인 모두 WF-04 복귀)를 동작 바 문구로 드러냈다. 목록은 평면 예시(계층 표현 [미확인]). |
| WF-04 Litpage | FR-OSS-001·003·002 / AC-FR-OSS-001-01·02, AC-FR-OSS-003-01·02 | 기본, A 자동 저장 실패, B 진입 실패, S 정지 차단(시안 추가·pending planning) | 작업 영역을 캔버스 전폭(좌우 32px)으로 늘리고, 상단 컨텍스트 바(서비스명·배지·현재 저장 폴더·「저장 폴더 변경」)로 위계를 만들었다. 작업 영역은 「Litpage 작업 영역」 라벨 점선 플레이스홀더이며 Litpage 제품 기능은 그리지 않았다. A는 Toast 대신 작업 영역 위 Inline alert(내용 유지), B·S는 작업 영역 자리에 안내 패널+「홈으로 돌아가기」. S의 차단 뒤 도착 화면은 [미확인]. |

## 열린 질문 (모두 기획 확인 필요)

- Q-090 테마 선택기 위치. 화면에 두지 않았다.
- 현재 저장 폴더를 WF-04에 표시할지(시안은 표시), 대상 서비스명을 WF-03에 표시할지(시안은 배지로 표시), 폴더 직접 입력·생성 UI·빈 목록·확인 실패.
- 자동 저장 성공 표시, 숨김 차단과 일반 진입 실패의 구분.
- 정지 계정: WF-01에서의 표현 vs WF-10, WF-04 차단 후 도착 화면.
- 카드 설명·종류 배지 문구, 복구 안내·닫기·라이선스 본문, 서비스·카테고리 이름 번역.
- 모바일 헤더 드로어·푸터 배치(NFR-USAB-001 이상은 [미확인]). 모바일 드로어 프레임은 이번 묶음에 만들지 않았다.

## 새 토큰·컴포넌트 제안

- 새 토큰: 없음. 기존 Deep Ink 31개 변수만 사용했다.
- 컴포넌트 제안(DS에는 반영하지 않음): 「카테고리 열 제목(금색 바+h3)」, 「서비스 카드 v2(아이콘·배지·설명·열기)」, 「점선 빈 카테고리」, 「컨텍스트 바」, 「브랜드 패널」. v2 파일의 「v2 · 화면 부품」 페이지에 시안용으로만 있다.
- 아이콘은 24px 고정으로 사용했다(인스턴스 크기 변경 시 글리프가 스케일되지 않음).

## 스킬 적용 메모

- **읽지 못함**: frontend-design, design-taste-frontend, ui-ux-pro-max, hallmark, web-design-guidelines의 SKILL.md는 이번 작업에서 실제로 열어 읽지 않았다. 프롬프트의 원칙(균형·가장자리 정렬·빈 화면 금지·위계·반슬롭)만 적용했다. 스킬 문서 기준 검수는 [미확인].
- 적용한 원칙: 최대 콘텐츠 폭+가운데 정렬, 그리드 카드, 로그인 2분할 브랜드 존재감, 장식 사진·가짜 마케팅 카피 배제, `accent`·`secondary`는 텍스트에 쓰지 않음(금색은 장식 룰·바에만).

## 검수와 한계

- PNG는 FigCraft MCP `file.export`로 56장 내보냈다. 글꼴(IBM Plex Sans KR/Sans)은 헤드리스 환경에서 대체 글꼴로 렌더링된다.
- 대비는 토큰 쌍 기준(DS 대비표)을 따랐고 화면 단위 실측은 하지 않았다. 키보드 포커스·읽기 순서는 [미확인].
- 호버·포커스·눌림 상태 프레임과 모바일 헤더 드로어는 이번 범위에 없다. 오류 아이콘은 `text` 색(상태색 틴트 미적용).
- `exports/v2/.keep`은 export 폴더 생성을 위한 플레이스홀더다.

---

# v3 — 스킬 실제 로드 후 정제 (WF-01~04)

v1·v2 절·파일·PNG는 비교용으로 그대로 둔다. v3는 v2 파일을 사본으로 열어 `screens-wf01-04-v3.figcraft`로 저장한 뒤 수정했다. **범위 정직성**: 레이아웃을 새로 짜지 않았고, v2의 구조(WF-01 2분할, WF-02 1200 그리드, WF-03 960 2패널, WF-04 컨텍스트 바+작업 영역)를 유지한 채 review-05의 minor 5건을 반영하고 드로어 프레임 8장과 한국어 줄바꿈 1건을 정리했다. 스킬은 이 판단과 점검의 기준으로 썼다(아래 기록). 「더 평범하지 않게」라는 목표 대비 시각적 변화는 제한적이며, 큰 재설계가 필요하면 별도 지시가 필요하다.

- FigCraft: [screens-wf01-04-v3.figcraft](screens-wf01-04-v3.figcraft). 페이지 이름에는 `v2`가 남아 있다(이름 변경은 하지 않음).
- PNG: `exports/v3/` 64장 = 기본 56 + 드로어 8. 파일명은 아트보드 이름과 같다.
- 기준: develop `4b66d1d` 기획 v1.0 + DEC-084·101·102. 테마 선택기(Q-090)는 어디에도 두지 않았다. 라이트·다크는 디자이너용 시안이다. 정지 계정 S 상태는 시안 추가(공식 동선 WF-10, pending planning)이며 WF-10은 그리지 않았다.

## 스킬 적용 기록

로드 방법: 다섯 스킬을 모두 Skill 도구로 호출했고, 아래 참조 파일을 Read로 열었다. 스크립트·네트워크는 쓰지 않았다(web-design-guidelines는 프롬프트에 인라인된 규칙 사용).

| 스킬 | 읽은 파일 | 가져온 규칙·권고 | 반영 위치 |
| --- | --- | --- | --- |
| frontend-design | `SKILL.md` | 구조적 장치(괄호·라벨·구분선)는 정보가 있을 때만, 모든 대문자 라벨·장식 카피 지양, 에러·빈 상태는 원인과 다음 행동을 안내, 한 곳에만 대담함을 쓰고 나머지는 절제 | 새 장식·카피를 추가하지 않음. WF-01 브랜드 패널의 금색 룰·아치 모티프(v2)를 유일한 시그니처로 유지. S·B 차단 패널은 원인+「홈으로 돌아가기」 하나만 둠 |
| ui-ux-pro-max | `SKILL.md`, `references/quick-reference.md`, `references/pro-rules.md`, `data/products.csv`(SaaS·생산성·B2B 행), `data/ui-reasoning.csv`(SaaS·생산성), `data/app-interface.csv` | 생산성/SaaS: Flat+마이크로인터랙션, 명확한 위계·기능색. `primary-action`(화면당 하나의 주 CTA), `touch-target-size`(44), `color-semantic`·`color-not-decorative-only`(오류색+아이콘/텍스트), `drawer-usage`·`empty-nav-state`(숨긴 항목은 제외·설명), `modal-escape`(닫기 제공), `dark-mode-pairing`, 스크림은 실제 배경 기준 | ① 오류·경고 아이콘 `error` 토큰. ② 상태 B·S 버튼을 둘 다 primary. ③ 드로어에 닫기(X) 포함, 상태 B 드로어에서 「문서」 제외. ④ 모바일 카드 힌트 보존(`content-priority`). CSV의 팔레트 hex는 쓰지 않음(브랜드는 Deep Ink 유지) |
| hallmark | `SKILL.md`, `references/craft.md`, `dark-mode.md`, `interaction-and-states.md`, `responsive.md` | 라벨·메타는 본문 글꼴의 한 단계 작은 크기·대문자 아님, 액센트는 신호로만, 다크는 반전이 아닌 재유도·그림자 대신 명도 단계, 오류는 색만으로 구분하지 않기, 터치 44, 빈 상태=무엇이 비었는지+이유+행동, 한 화면 약 80단어 | 힌트 문구는 12px 본문 글꼴·text-muted. 다크 프레임은 같은 변수의 Dark 모드 그대로(재유도 값은 DS 소유). 드로어 스크림은 `overlay` 토큰. 금색은 장식에만. 히어로·섀도·애니메이션 규칙은 마케팅용이라 이식하지 않음 |
| web-design-guidelines | `SKILL.md` + 프롬프트 인라인 규칙 | 아이콘 전용 버튼의 접근 이름(메뉴·닫기), 장식 아이콘 숨김, 포커스 가시성, 인라인 오류+다음 행동, 터치 44, 한국어 문구 우선, 파괴적 동작 확인 | 메뉴·닫기 버튼 44×44(DS 드로어에 「메뉴 닫기」·「NaruWorks 홈」 히트 영역 이름 있음). 오류 문구는 원인+다음 행동 유지. 구현 단계 규칙(aria, 포커스 링)은 시안으로 검증 불가 → [미확인] |
| design-taste-frontend | `SKILL.md`, `references/layout-v4.md` | 가장자리 정렬(같은 좌우 콘텐츠 선), 상단 정렬·한 화면 한 목적, 빈 화면 금지, 반슬롭. 랜딩 히어로·셰이더·사진 규칙은 제외 | 콘텐츠 폭·정렬은 v2 그대로 유지(재점검: 1200/960 가운데 정렬, 푸터 전폭). 새 장식 없음 |

## 화면별 (v2 대비)

| 화면 | WF / FR·AC | 상태 | v2·와이어프레임 대비 |
| --- | --- | --- | --- |
| WF-01 로그인 | FR-AUTH-001·004·005 / AC-FR-AUTH-001-01~03, AC-FR-AUTH-005-01 | 기본, A, S(시안 추가) | 레이아웃 v2와 동일(와이어프레임은 단일 카드, v2에서 2분할로 변경). **변경**: A·S 경고 아이콘 색 `text`→`error`(minor 3). |
| WF-02 서비스 목록 홈 | FR-HOME-001·002, FR-AUTH-004, FR-SHELL-001·002 / AC-FR-HOME-001-01·02, AC-FR-HOME-002-01·02 | 기본, A, B, C, D | 데스크톱 v2와 동일. **변경**: 모바일 카드에 보조 힌트 추가(minor 1), 모바일 드라이브 설명의 줄바꿈을 「…내려받고,/공유합니다.」로 정리(단어 중간 끊김 제거). 드로어 4장 추가. |
| WF-03 저장 폴더 선택 | FR-OSS-002 / AC-FR-OSS-002-01~04 | 기본, A | v2와 동일. 드로어 2장 추가(모바일은 첫 화면 812px까지 보이도록 잘라 둠). |
| WF-04 Litpage | FR-OSS-001·003·002 / AC-FR-OSS-001-01·02, AC-FR-OSS-003-01·02 | 기본, A, B, S(시안 추가) | v2와 동일. **변경**: A·B·S 경고 아이콘 `error`(minor 3), S의 「홈으로 돌아가기」 primary(minor 2). 드로어 2장 추가. |

## v2 minor 5건

1. **모바일 힌트**(WF-02): 두 모바일 카드에 12px text-muted 한 줄을 추가했다. 데스크톱 문구 그대로는 카드 폭(약 194px)에 한 줄로 안 들어가 **짧게 줄였다**: Litpage 「처음 열 때 저장 폴더 선택」(데스크톱 「처음 열 때 저장 폴더를 선택합니다」), 드라이브 「파일당 1GB 이하 업로드」(동일). 상태 A·B·C·D 모바일 카드에도 반영(오버레이 C·D의 배경 카드 포함). 모바일 카드 인스턴스는 힌트를 넣기 위해 **분리(detach)**했다(마스터 `card-*-mobile`은 그대로; 반영하려면 DS 컴포넌트 갱신 필요 — 아래 제안).
2. **버튼 위계**(WF-04): 상태 S 4장의 「홈으로 돌아가기」를 secondary→primary(`primary` 채움, `on-primary` 글자)로 바꿔 상태 B와 같다. 화면당 주 CTA 1개 규칙에도 맞는다.
3. **오류 아이콘**: WF-01 A·S, WF-04 A·B·S의 경고 아이콘 글리프 선을 `error` 변수에 바인딩(라이트 `#B42318`/다크 `#F2766B`). 아이콘 옆 제목·본문이 있어 색만으로 의미를 전달하지 않는다.
4. **모바일 드로어**: DS 「Common header · 모바일 드로어」(full / drive-only, Light/Dark) 인스턴스를 모바일 프레임 위에 얹고 `overlay` 스크림을 깔았다. 일반 회원이라 프로필·로그아웃만 있고 관리는 없다. WF-02 상태 B는 drive-only(「문서」·Litpage 없음). 드로어 헤더가 DS 기준 64px라 v2 화면 헤더(56px)와 8px 차이 난다 — 드로어가 헤더를 덮는 시안이므로 그대로 두었다.
5. **PNG 링크 표**: 아래.

## PNG 링크 표 (`exports/v3/`)

| 화면·상태 | 데스크톱 라이트 | 데스크톱 다크 | 모바일 라이트 | 모바일 다크 |
| --- | --- | --- | --- | --- |
| WF-01 기본 | [파일](exports/v3/WF-01-login-desktop-light.png) | [파일](exports/v3/WF-01-login-desktop-dark.png) | [파일](exports/v3/WF-01-login-mobile-light.png) | [파일](exports/v3/WF-01-login-mobile-dark.png) |
| WF-01 A | [파일](exports/v3/WF-01-login-desktop-light-state-A.png) | [파일](exports/v3/WF-01-login-desktop-dark-state-A.png) | [파일](exports/v3/WF-01-login-mobile-light-state-A.png) | [파일](exports/v3/WF-01-login-mobile-dark-state-A.png) |
| WF-01 S | [파일](exports/v3/WF-01-login-desktop-light-state-S.png) | [파일](exports/v3/WF-01-login-desktop-dark-state-S.png) | [파일](exports/v3/WF-01-login-mobile-light-state-S.png) | [파일](exports/v3/WF-01-login-mobile-dark-state-S.png) |
| WF-02 기본 | [파일](exports/v3/WF-02-home-desktop-light.png) | [파일](exports/v3/WF-02-home-desktop-dark.png) | [파일](exports/v3/WF-02-home-mobile-light.png) | [파일](exports/v3/WF-02-home-mobile-dark.png) |
| WF-02 A | [파일](exports/v3/WF-02-home-desktop-light-state-A.png) | [파일](exports/v3/WF-02-home-desktop-dark-state-A.png) | [파일](exports/v3/WF-02-home-mobile-light-state-A.png) | [파일](exports/v3/WF-02-home-mobile-dark-state-A.png) |
| WF-02 B | [파일](exports/v3/WF-02-home-desktop-light-state-B.png) | [파일](exports/v3/WF-02-home-desktop-dark-state-B.png) | [파일](exports/v3/WF-02-home-mobile-light-state-B.png) | [파일](exports/v3/WF-02-home-mobile-dark-state-B.png) |
| WF-02 C | [파일](exports/v3/WF-02-home-desktop-light-state-C.png) | [파일](exports/v3/WF-02-home-desktop-dark-state-C.png) | [파일](exports/v3/WF-02-home-mobile-light-state-C.png) | [파일](exports/v3/WF-02-home-mobile-dark-state-C.png) |
| WF-02 D | [파일](exports/v3/WF-02-home-desktop-light-state-D.png) | [파일](exports/v3/WF-02-home-desktop-dark-state-D.png) | [파일](exports/v3/WF-02-home-mobile-light-state-D.png) | [파일](exports/v3/WF-02-home-mobile-dark-state-D.png) |
| WF-03 기본 | [파일](exports/v3/WF-03-save-folder-desktop-light.png) | [파일](exports/v3/WF-03-save-folder-desktop-dark.png) | [파일](exports/v3/WF-03-save-folder-mobile-light.png) | [파일](exports/v3/WF-03-save-folder-mobile-dark.png) |
| WF-03 A | [파일](exports/v3/WF-03-save-folder-desktop-light-state-A.png) | [파일](exports/v3/WF-03-save-folder-desktop-dark-state-A.png) | [파일](exports/v3/WF-03-save-folder-mobile-light-state-A.png) | [파일](exports/v3/WF-03-save-folder-mobile-dark-state-A.png) |
| WF-04 기본 | [파일](exports/v3/WF-04-litpage-desktop-light.png) | [파일](exports/v3/WF-04-litpage-desktop-dark.png) | [파일](exports/v3/WF-04-litpage-mobile-light.png) | [파일](exports/v3/WF-04-litpage-mobile-dark.png) |
| WF-04 A | [파일](exports/v3/WF-04-litpage-desktop-light-state-A.png) | [파일](exports/v3/WF-04-litpage-desktop-dark-state-A.png) | [파일](exports/v3/WF-04-litpage-mobile-light-state-A.png) | [파일](exports/v3/WF-04-litpage-mobile-dark-state-A.png) |
| WF-04 B | [파일](exports/v3/WF-04-litpage-desktop-light-state-B.png) | [파일](exports/v3/WF-04-litpage-desktop-dark-state-B.png) | [파일](exports/v3/WF-04-litpage-mobile-light-state-B.png) | [파일](exports/v3/WF-04-litpage-mobile-dark-state-B.png) |
| WF-04 S | [파일](exports/v3/WF-04-litpage-desktop-light-state-S.png) | [파일](exports/v3/WF-04-litpage-desktop-dark-state-S.png) | [파일](exports/v3/WF-04-litpage-mobile-light-state-S.png) | [파일](exports/v3/WF-04-litpage-mobile-dark-state-S.png) |

모바일 드로어(추가 8장):

| 화면 | 라이트 | 다크 |
| --- | --- | --- |
| WF-02 기본 | [파일](exports/v3/WF-02-home-mobile-light-drawer.png) | [파일](exports/v3/WF-02-home-mobile-dark-drawer.png) |
| WF-02 상태 B(「문서」 없음) | [파일](exports/v3/WF-02-home-mobile-light-state-B-drawer.png) | [파일](exports/v3/WF-02-home-mobile-dark-state-B-drawer.png) |
| WF-03 | [파일](exports/v3/WF-03-save-folder-mobile-light-drawer.png) | [파일](exports/v3/WF-03-save-folder-mobile-dark-drawer.png) |
| WF-04 | [파일](exports/v3/WF-04-litpage-mobile-light-drawer.png) | [파일](exports/v3/WF-04-litpage-mobile-dark-drawer.png) |

## 열린 질문 (모두 기획 확인 필요)

- Q-090 테마 선택기 위치(화면에 두지 않음). 모바일 드로어에도 두지 않았다.
- 모바일 카드 힌트의 최종 문구(데스크톱과 같은 문장을 쓸지, 짧은 문구를 쓸지).
- 정지 계정: WF-01 표현 vs WF-10, WF-04 차단 뒤 도착 화면.
- 현재 저장 폴더 WF-04 표시 여부, 자동 저장 성공 표시, 숨김 차단과 일반 진입 실패 구분.
- 모바일 헤더 드로어·푸터 배치(NFR-USAB-001 이상은 [미확인]). 드로어 항목 순서(서비스·카테고리·회원)는 DS 컴포넌트 그대로다.

## 새 토큰·컴포넌트 제안

- 새 토큰: 없음. 기존 31개 변수만 사용(`overlay`, `error`, `primary`, `on-primary`, `text-muted` 포함).
- 컴포넌트 제안(DS에는 반영하지 않음): 「서비스 카드(모바일)」 마스터에 힌트 줄 슬롯 추가. 현재 v3의 모바일 카드 16개는 인스턴스에서 분리된 상태다. 「에러 아이콘 틴트」를 `icon/warning` 변형(tone=error)으로 제공하면 아이콘 색을 화면마다 덮어쓰지 않아도 된다.

## 검수와 한계

- PNG 64장은 FigCraft MCP `file.exportLayers`로 내보냈다. 글꼴(IBM Plex Sans KR/Sans)은 헤드리스 환경에서 대체 글꼴로 렌더링될 수 있다(v2와 같음).
- 직접 눈으로 확인한 프레임: WF-04 S 데스크톱/모바일 라이트, WF-02 모바일 기본 라이트·다크·A·B·C(축소), WF-02 드로어 4장, WF-03 드로어 라이트. 나머지 PNG(WF-01 전체, WF-03 일부, WF-04 A·B 등)는 변경 후 개별 시각 검토를 하지 않았다 — **[미확인]**.
- 대비는 토큰 쌍 기준(v2와 동일). 힌트 12px text-muted는 라이트 7.4:1, 다크 6.1:1(review-05 계산값, surface-raised 기준). 키보드 포커스·읽기 순서·터치 동작은 [미확인].
- 모바일 카드 힌트 추가 후 카드 높이가 약 18px 늘었다. 812px 프레임 안에 들어가는 것은 확인했으나 소형 기기(예: 320px 폭)는 [미확인].
- 호버·포커스·눌림 상태, 로딩 화면은 이번 범위에 없다.

---

## v4 (P3-4) · 구성부터 새로 디자인

호배님 결정(2026-11-19 19:05 KST): 「v2를 그대로 두지 말고 화면 구성부터 새로 다시 디자인해요.」 v4는 v1·v2·v3의 FigCraft 파일, PNG, 절의 레이아웃 설명을 열거나 복사하거나 참고하지 않고, 기획 기능 목록(`screen-data-actions.md`)과 디자인 시스템 v0.3의 토큰·아이콘·브랜드 자산만으로 새 빈 파일 [screens-wf01-04-v4.figcraft](screens-wf01-04-v4.figcraft)에서 시작했다. 라이트/다크 프레임은 디자이너용 시안이며 테마 선택기 위치는 Q-090이라 어떤 프레임에도 확정 배치하지 않는다. 터치 기기는 마우스 올림 썸네일을 생략한다(DEC-084). 계정에 저장되는 테마(DEC-101)와 WCAG 2.1 AA(DEC-102)를 따른다.

### v4 공통 구성 원리

- **한 가지 기억할 장치: 아치와 수면선.** 로고의 아치(두 기슭을 잇는 문)와 수면선을 화면 구조에 쓴다. 로그인에서는 아치 모양의 입구 카드가 중심이 되고, 나머지 화면에서는 아치 메달리온으로 반복된다. 메달리온은 장식이 아니라 「이 자리가 어떤 서비스인지, 또는 지금 어떤 상태인지」를 알리는 표지에만 쓴다: 홈의 서비스 카드, WF-03 보조 패널의 서비스(Litpage), WF-04 작업 영역 플레이스홀더와 차단 카드, WF-01 상태 S. 폼·목록·알림 안에는 쓰지 않는다. 금색 `accent`는 수면선 한 줄과 메달리온 호의 점 하나에만 쓰는 장식이며 텍스트 색으로 쓰지 않는다.
- **표면 계층으로 깊이를 만든다.** `bg` → `surface`(캔버스 면) → `surface-raised`(카드) 3단. 그림자는 카드 레벨 1 하나만 쓰고, 다크에서는 `surface-raised` 명도 차로 구분한다.
- **데스크톱은 1440 캔버스를 쓴다.** 콘텐츠 최대 폭 1120(좌우 가운데). 12열 그리드 위에서 열 시작선에 맞춘다. 헤더·푸터는 전폭 띠, 본문은 가운데 정렬 구성이다.
- **타이포 리듬.** `display` 48/56은 로그인 제목 한 곳, `h1` 40은 홈·저장 폴더 화면 제목, `h2` 28은 카테고리·카드 제목, `h3` 20, 본문 16/26, 힌트 14/22. 굵기는 700/600/400만 쓴다. 한국어는 `word-break: keep-all`을 전제로 문구를 의미 단위로 끊는다.
- **모바일 360.** 한 열, 좌우 16, 조작 요소 44px 이상, 푸터는 세로로 흐른다. 헤더는 로고와 메뉴 버튼이며, 서비스 전환·카테고리·프로필·로그아웃은 우측 드로어에 둔다.
- **아이콘.** 디자인 시스템의 커스텀 아이콘 SVG(`icons/`)의 경로를 그대로 벡터로 옮겨 쓴다. 단독 아이콘 버튼은 접근 이름을 주석에 남긴다.

### 구성 근거 (그리기 전에 작성)

#### WF-01 로그인

- **주요 목표:** 한 번의 Google 로그인으로 들어간다. 취소·실패 뒤 같은 화면에서 다시 시도한다. 정지 계정은 막힌 이유를 알고 로그인 화면으로 돌아간다.
- **정보 위계:** (1) 「로그인」 제목과 Google 버튼 (2) 가입 안내 한 줄 (3) 푸터. 헤더는 없다.
- **구성:** **아치 입구.** 캔버스 전체가 `surface`이고, 가운데에 위쪽이 반원인 아치 카드(`surface-raised`, 폭 480)가 서 있다. 카드 뒤로 수면선 세 줄이 화면 끝까지 흐르고 그중 한 줄만 금색이다. 아치는 브랜드 심볼의 확대이며 「나루」(건너는 곳)의 입구를 뜻한다. 왼쪽 좁은 열이나 빈 데스크톱이 생기지 않도록 카드는 가운데, 수면선은 전폭으로 둔다. 모바일은 같은 아치가 폭 전체를 쓰고 수면선이 카드 아래로 이어진다. 상태 A는 카드 안 오류 알림(아이콘은 `error` 색), 상태 S는 카드 내용을 차단 안내로 바꾼다.
- **이끈 스킬 규칙:** design-taste(균형·양쪽 가장자리 정렬·빈 화면 금지), frontend-design(한 요소에만 대담함을 쓴다·제품 고유 모티프), hallmark(장식 상태점·라벨 금지, 한 화면 한 동작), ui-ux-pro-max(primary-action 하나, error-recovery, form 상태).

#### WF-02 서비스 목록 홈

- **주요 목표:** 쓸 서비스를 빨리 골라 들어간다. 드물게 복구 안내와 라이선스 고지를 본다.
- **정보 위계:** (1) 「서비스」 제목 (2) 카테고리별 서비스 카드 (3) 처음 열 때 저장 폴더 선택·파일당 1GB 보조 힌트 (4) 푸터.
- **구성:** **카테고리 선반.** 카테고리가 가로 줄(선반)이다. 한 줄은 왼쪽 카테고리 이름(`h2`)과 항목 수, 오른쪽에 가로로 넓은 서비스 카드이다. 카드 왼쪽에 아치 메달리온(서비스 아이콘 `file-text`·`drive`)이 서고 이름·종류 배지·힌트·열기 동작이 이어진다. 카드는 한 줄을 다 채우므로 데스크톱 캔버스가 비지 않고, 카테고리가 늘어도 줄만 더하면 된다. 헤더의 카테고리 버튼은 이 줄로 이동한다. 상태 B는 「문서」 줄이 사라진다. 상태 A는 카드 자리에 점선 빈 상태를 둔다.
- **이끈 스킬 규칙:** ui-ux-pro-max(생산성/SaaS: 신뢰 블루 + 절제된 대비·Swiss 그리드·dashboard 밀도 중간), design-taste(가장자리 정렬·카드 행이 한 줄을 채움), hallmark(표면 사다리: 여백 → 면 → 카드, 카드 안 카드 금지), web-design-guidelines(링크는 링크, 카드 전체가 하나의 `<a>`, 호버 대비 상승).

#### WF-03 저장 폴더 선택

- **주요 목표:** 결과물을 저장할 폴더를 정한다. 기본값 `/litpage`를 그대로 확정하는 것이 기본 동선이다.
- **정보 위계:** (1) 현재 선택 경로 (2) 폴더 목록 (3) 확인·취소 (4) 변경 안내.
- **구성:** **목적지 확인대.** 위쪽에 큰 「선택한 위치」 경로 띠(아치 핀 아이콘 + `/litpage` + 기본값 배지)가 있고, 그 아래 폴더 목록 카드가 가운데 폭 720으로 이어지며, 카드 바닥에 확인·취소가 붙는다. 한눈에 「지금 뭐가 선택됐고 확인하면 어디로 가는지」가 읽힌다. 오른쪽에는 서비스(Litpage)와 안내를 담은 보조 패널을 두어 1440에서 가운데 두 열 구성이 된다. 폴더 목록 바로 아래, 확인·취소 위에는 「기본 폴더가 없으면 만들어 쓸 수 있습니다.」 안내 한 줄을 둔다(screen-data 「기본 폴더 없음 안내」, FR-OSS-002·AC-FR-OSS-002-01). 목록을 보다가 기본 폴더가 안 보일 때 바로 읽히는 자리이며, 만들기 버튼이나 폴더 생성 화면은 screen-data가 [미확인]이라 그리지 않았다. 상태 A의 변경 재사용 알림은 **데스크톱에서는 보조 패널 맨 위**, **모바일에서는 확인·취소 버튼 바로 아래 안내 묶음 맨 위**에 둔다. 이 알림은 「확인하면 무엇이 달라지는가」를 알리므로 선택 흐름(경로 → 목록 → 확인)을 끊지 않고 확인 결과를 설명하는 보조 영역에 모은다. 위치는 화면 폭에 따라 달라지지만 원칙은 같다: 알림은 선택 카드 안·경로 띠 위가 아니라 확인 결과를 설명하는 보조 영역에 둔다. 메달리온은 이 보조 패널에서 서비스 표지 역할이다.
- **이끈 스킬 규칙:** ui-ux-pro-max(multi-step 아닌 한 단계 확인·destructive 아님·취소 경로), hallmark(동작은 하나의 primary), web-design-guidelines(라벨 있는 필드, 취소·확인 위치 일관).

#### WF-04 Litpage

- **주요 목표:** Litpage에서 문서를 쓴다. 저장 위치를 확인하고 필요하면 바꾼다. 실패하면 이유와 다음 행동을 안다.
- **정보 위계:** (1) 작업 영역 (2) 저장 폴더 (3) 상태 알림.
- **구성:** **작업대.** 헤더 아래 전폭 도구 띠(왼쪽 서비스 이름 Litpage, 오른쪽 저장 폴더 칩 + 「저장 폴더 변경」)와 그 아래 가능한 한 큰 작업 영역(라벨 있는 플레이스홀더, Litpage 기능을 추측해 그리지 않는다)으로 이루어진다. 캔버스의 대부분이 작업 영역이므로 빈 화면이 생기지 않는다. 상태 A는 도구 띠 아래에 오류 알림이 끼어든다. 상태 B·S는 작업대가 차단 카드로 바뀌며 가운데 정렬 아이콘·제목·본문·primary 「홈으로 돌아가기」를 둔다.
- **이끈 스킬 규칙:** frontend-design(작업 도구는 조용하게, 대담함은 한 곳), design-taste(균형), ui-ux-pro-max(error-clarity: 원인+다음 행동, 오류 아이콘만 색), web-design-guidelines(오류는 인라인, `aria-live="polite"`).

### 스킬 적용 기록

| 스킬 | 가져온 규칙·권고 | 반영한 화면·상태 |
| --- | --- | --- |
| frontend-design | 주제(나루·건너는 곳)에서 시각 언어를 끌어온다. 한 요소에만 대담함을 쓴다. 장식 라벨·글머리 번호·한 단어 강조 금지. 오류는 사과 없이 원인과 해결을 말한다. | WF-01 아치 입구와 수면선, 서비스·상태 표지로서의 아치 메달리온(WF-02 카드, WF-03 보조 패널, WF-04 작업 영역·차단 카드, WF-01 S), 전 화면 오류 문구 |
| design-taste-frontend | 마케팅 히어로·셰이더·사진 규칙은 제외하고 균형·양쪽 가장자리 정렬·빈 화면 금지·위계·반슬롭만 적용. 같은 요소를 한쪽 구석에 몰지 않는다. 카드 행은 줄을 가득 채운다. | WF-02 선반 행, WF-04 큰 작업 영역, 데스크톱 1120 가운데 정렬 |
| ui-ux-pro-max | 생산성·SaaS 행: 신뢰 블루 + 절제된 포인트, Minimalism & Swiss, 과한 애니메이션 금지. `quick-reference`: 대비 4.5:1, 터치 44px, 8px 간격, 화면당 primary 하나, 오류 근처 메시지, 빈 상태는 행동 제안, 드로어는 닫기 제공. 팔레트 CSV hex는 쓰지 않고 Deep Ink 토큰만 사용. | 전 화면 버튼 위계, WF-02 상태 A 빈 상태, 모바일 드로어 닫기 버튼 |
| hallmark | 라벨은 본문 서체로 소문자 격. 장식 상태점·가운뎃점 메타 문자열·화살표 붙은 링크 금지. 카드 안 카드 금지. 다크는 반전이 아니라 재도출: 그림자 대신 명도 단계, 순흑 금지. 8상태 중 기본·포커스·비활성 구분. | 푸터 링크, 다크 프레임(Deep Ink 다크 토큰), 카드 계층 |
| web-design-guidelines | 인라인 규칙 적용(네트워크 미사용): 아이콘 버튼 접근 이름, 포커스 가시성, 폼 라벨, 오류는 인라인, 터치 44px, 파괴적 동작 확인, 다크 모드 `color-scheme`, `…` 말줄임, 비율 유지 줄바꿈. | WF-01 버튼, WF-03 필드·폴더 목록, 모바일 헤더 버튼, 드로어 |

### v4 프레임과 상태 (WF · FR/AC · 상태)

화면·상태 14개 × 데스크톱·모바일 × 라이트·다크 = 56장에 모바일 드로어 8장을 더해 **데스크톱 28장 + 모바일 28장 + 드로어 8장 = 64장**이다(기본 56 + 드로어 8). 데스크톱 1440×900(WF-02 이하 모두 고정 900), 모바일 폭 360(높이는 내용에 맞춘 hug, 드로어 프레임은 뷰포트 360×800). FigCraft 파일에서 라이트·다크는 같은 구조이고 변수 컬렉션 `Deep Ink`의 Light/Dark 모드만 바꿨다.

| WF | 상태 | 관련 FR / AC | 화면 내용 |
| --- | --- | --- | --- |
| WF-01 로그인 | 기본 | FR-AUTH-001 · AC-FR-AUTH-001-01 | 아치 입구 카드, 「로그인」, 안내 문구, 「Google로 로그인」, 푸터(헤더 없음) |
| WF-01 | A 인증 취소·실패 | AC-FR-AUTH-001-03 | 카드 안 인라인 오류 알림(아이콘 `error`), 같은 버튼으로 재시도 |
| WF-01 | S 정지 계정 (시안 추가) | FR-AUTH-005 · AC-FR-AUTH-005-01·03 (공식 동선 WF-10, pending planning) | 오류 메달리온, 「로그인할 수 없습니다」, 「로그인 화면으로」(primary). WF-10 화면은 그리지 않음 |
| WF-02 홈 | 기본 | FR-HOME-001·002 · AC-FR-HOME-001-01, AC-FR-HOME-002-01 | 문서(Litpage)·저장소(나루 드라이브) 선반, 카드 보조 힌트 |
| WF-02 | A 빈 카테고리 | AC-FR-HOME-002-02 | 「문서」 줄이 점선 빈 상태, 서비스 0개 |
| WF-02 | B 오픈소스 숨김 | AC-FR-HOME-001-02, AC-FR-ADM-003-02 | 드라이브만 표시, 헤더·카테고리에 「문서」 없음 |
| WF-02 | C 복구 안내 | AC-FR-AUTH-004-01·03 | 모달, `[문구 미확정]`, 「닫기」 |
| WF-02 | D 라이선스 고지 | AC-FR-SHELL-002-04 | 같은 창 대화상자, 본문 `[문구 미확정]` 스크롤 영역, 닫기 |
| WF-03 저장 폴더 선택 | 기본(첫 진입) | FR-OSS-002 · AC-FR-OSS-002-01·02 | 선택 경로 `/litpage`(기본값 배지), 폴더 목록, 「기본 폴더가 없으면 만들어 쓸 수 있습니다.」 안내(FR-OSS-002·AC-FR-OSS-002-01·UF-02), 취소→WF-02, 확인→WF-04 |
| WF-03 | A 변경 재사용 안내 | AC-FR-OSS-002-03·04 | 정보 알림(이후 결과물만 새 폴더, 기존 결과물은 옮기지 않음)은 데스크톱 보조 패널 맨 위·모바일 버튼 아래. 기본 폴더 없음 안내 유지. 취소→WF-04 |
| WF-04 Litpage | 기본 | FR-OSS-001·003 · AC-FR-OSS-001-01, AC-FR-OSS-003-01 | 도구 띠(저장 폴더 칩 + 「저장 폴더 변경」), 라벨 있는 작업 영역 플레이스홀더 |
| WF-04 | A 자동 저장 실패 | AC-FR-OSS-003-02 | 오류 알림(아이콘 `error`), 작업 내용 유지 안내 |
| WF-04 | B 진입 실패 | AC-FR-OSS-001-02 | 차단 카드, 「홈으로 돌아가기」 primary |
| WF-04 | S 정지 계정 진입 차단 (시안 추가, pending planning) | FR-AUTH-005 연결 [미확인] | B와 같은 구성, 문구 `[문구 미확정]`, 「홈으로 돌아가기」 primary |

공통 헤더(일반 회원)·푸터(이용약관, 개인정보처리방침, 오픈소스 라이선스 고지, 문의 `aslanhobae@gmail.com`, `Dev. Aslan0`)를 WF-02~04 헤더와 WF-01~04 푸터에 반영했다. 회사 정보는 없다. 로그인 화면 헤더는 없다. 썸네일(GAP-017)은 이 네 화면에 해당 없음.

### minor 반영 결과

| # | 항목 | 반영 |
| --- | --- | --- |
| 1 | WF-02 모바일 카드 보조 힌트 | 두 카드 모두 서비스 설명 아래에 한 줄로 유지: `처음 열 때 저장 폴더를 선택합니다`(Litpage), `파일당 1GB 이하 업로드`(나루 드라이브). 14px 한 줄로 360에서 줄바꿈 없이 들어가며 생략하지 않았다. 카드 높이가 늘어 모바일 홈 프레임은 고정 높이가 아니라 hug로 두었다(약 1086px) |
| 2 | WF-04 B·S 「홈으로 돌아가기」 | 두 상태 모두 primary 버튼, 데스크톱 hug 폭·모바일 가득 폭으로 통일 |
| 3 | 오류·경고 아이콘 색 | WF-01 A·S, WF-04 A·B·S의 `warning` 아이콘 선 색은 변수 `error`에 바인딩(라이트 `#B42318`, 다크 `#F2766B`). 안내 아이콘은 `info`에 바인딩 |
| 4 | 모바일 헤더 드로어 | WF-02·03·04 기본 × 라이트·다크 6장 + WF-02 상태 B(오픈소스 숨김: 서비스 전환에 Litpage 없음, 카테고리에 「문서」 없음) × 라이트·다크 2장. 일반 회원: 프로필·로그아웃만(관리 없음). 닫기 아이콘 버튼의 접근 이름은 프레임 이름에 적었다. 테마 선택기는 넣지 않았다(Q-090) |
| 5 | PNG 링크 표 | 아래 표 |

### 열린 질문

- Q-090 테마 선택기 위치: 어떤 프레임에도 배치하지 않았다. 드로어·헤더 모두 비어 있다.
- 모바일 헤더·푸터 배치(`screen-data` 「모바일 배치 [미확인]」)와 드로어의 항목 구성은 디자인 제안이다. 기획 확인이 필요하다.
- WF-01·WF-04 상태 S: 공식 v1.0 동선은 WF-10이다. 정지 계정이 Litpage에 직접 진입하는 경로와 문구는 pending planning이다.
- `[문구 미확정]` 유지: 복구 안내, 라이선스 고지 본문, 정지 안내.
- 로딩·인증 진행 중 표현은 기획에 없어 그리지 않았다. 폴더가 없을 때의 WF-03 목록 표시와 폴더 만들기 UI도 기획 확인 필요.
- WF-04 작업 영역은 라벨 있는 플레이스홀더이고 Litpage 내부 기능은 그리지 않았다. 「저장 폴더 현재 경로를 화면에 표시하는지」는 기획 [미확인]이어서 칩으로 보여 주는 안이다.
- 카테고리 헤더 버튼이 홈의 해당 줄로 이동하는 방식(스크롤 위치)은 정적 시안에서 표현하지 않았다.

### 새 토큰·컴포넌트 제안

새 색 토큰은 없다. 디자인 시스템에는 쓰지 않았고 아래는 제안이다.

- **Arch medallion**(아치 메달리온): 서비스 카드·빈/차단 상태·사이드 패널에 쓴 위가 반원인 아이콘 판(80×96 radius [40,40,12,12], 아이콘 24, 금색 수면선 2×28). 컴포넌트로 승격할지 검토.
- **Arch entrance card**: 로그인 전용 480×(520~616) 카드(위 radius 240). 다른 화면에는 쓰지 않는다.
- **Drawer panel**: 모바일 헤더 드로어(304폭, 서비스 전환·카테고리·프로필·로그아웃). 디자인 시스템 Common header의 `mobile/open`과 조정이 필요하다.
- **Inline alert**의 `info` 변형과 테두리 규칙(아이콘만 상태색, 본문은 `text`)은 DS 알림 컴포넌트와 맞춰야 한다.

### PNG 파일 링크 표 (`exports/v4/`)

| 화면·상태 | 데스크톱 라이트 | 데스크톱 다크 | 모바일 라이트 | 모바일 다크 |
| --- | --- | --- | --- | --- |
| WF-01 기본 | [png](exports/v4/WF-01-login-desktop-light.png) | [png](exports/v4/WF-01-login-desktop-dark.png) | [png](exports/v4/WF-01-login-mobile-light.png) | [png](exports/v4/WF-01-login-mobile-dark.png) |
| WF-01 A | [png](exports/v4/WF-01-login-desktop-light-state-A.png) | [png](exports/v4/WF-01-login-desktop-dark-state-A.png) | [png](exports/v4/WF-01-login-mobile-light-state-A.png) | [png](exports/v4/WF-01-login-mobile-dark-state-A.png) |
| WF-01 S | [png](exports/v4/WF-01-login-desktop-light-state-S.png) | [png](exports/v4/WF-01-login-desktop-dark-state-S.png) | [png](exports/v4/WF-01-login-mobile-light-state-S.png) | [png](exports/v4/WF-01-login-mobile-dark-state-S.png) |
| WF-02 기본 | [png](exports/v4/WF-02-home-desktop-light.png) | [png](exports/v4/WF-02-home-desktop-dark.png) | [png](exports/v4/WF-02-home-mobile-light.png) | [png](exports/v4/WF-02-home-mobile-dark.png) |
| WF-02 A | [png](exports/v4/WF-02-home-desktop-light-state-A.png) | [png](exports/v4/WF-02-home-desktop-dark-state-A.png) | [png](exports/v4/WF-02-home-mobile-light-state-A.png) | [png](exports/v4/WF-02-home-mobile-dark-state-A.png) |
| WF-02 B | [png](exports/v4/WF-02-home-desktop-light-state-B.png) | [png](exports/v4/WF-02-home-desktop-dark-state-B.png) | [png](exports/v4/WF-02-home-mobile-light-state-B.png) | [png](exports/v4/WF-02-home-mobile-dark-state-B.png) |
| WF-02 C | [png](exports/v4/WF-02-home-desktop-light-state-C.png) | [png](exports/v4/WF-02-home-desktop-dark-state-C.png) | [png](exports/v4/WF-02-home-mobile-light-state-C.png) | [png](exports/v4/WF-02-home-mobile-dark-state-C.png) |
| WF-02 D | [png](exports/v4/WF-02-home-desktop-light-state-D.png) | [png](exports/v4/WF-02-home-desktop-dark-state-D.png) | [png](exports/v4/WF-02-home-mobile-light-state-D.png) | [png](exports/v4/WF-02-home-mobile-dark-state-D.png) |
| WF-03 기본 | [png](exports/v4/WF-03-folder-desktop-light.png) | [png](exports/v4/WF-03-folder-desktop-dark.png) | [png](exports/v4/WF-03-folder-mobile-light.png) | [png](exports/v4/WF-03-folder-mobile-dark.png) |
| WF-03 A | [png](exports/v4/WF-03-folder-desktop-light-state-A.png) | [png](exports/v4/WF-03-folder-desktop-dark-state-A.png) | [png](exports/v4/WF-03-folder-mobile-light-state-A.png) | [png](exports/v4/WF-03-folder-mobile-dark-state-A.png) |
| WF-04 기본 | [png](exports/v4/WF-04-litpage-desktop-light.png) | [png](exports/v4/WF-04-litpage-desktop-dark.png) | [png](exports/v4/WF-04-litpage-mobile-light.png) | [png](exports/v4/WF-04-litpage-mobile-dark.png) |
| WF-04 A | [png](exports/v4/WF-04-litpage-desktop-light-state-A.png) | [png](exports/v4/WF-04-litpage-desktop-dark-state-A.png) | [png](exports/v4/WF-04-litpage-mobile-light-state-A.png) | [png](exports/v4/WF-04-litpage-mobile-dark-state-A.png) |
| WF-04 B | [png](exports/v4/WF-04-litpage-desktop-light-state-B.png) | [png](exports/v4/WF-04-litpage-desktop-dark-state-B.png) | [png](exports/v4/WF-04-litpage-mobile-light-state-B.png) | [png](exports/v4/WF-04-litpage-mobile-dark-state-B.png) |
| WF-04 S | [png](exports/v4/WF-04-litpage-desktop-light-state-S.png) | [png](exports/v4/WF-04-litpage-desktop-dark-state-S.png) | [png](exports/v4/WF-04-litpage-mobile-light-state-S.png) | [png](exports/v4/WF-04-litpage-mobile-dark-state-S.png) |

모바일 드로어(360×800)

| 화면 | 라이트 | 다크 |
| --- | --- | --- |
| WF-02 기본 드로어 | [png](exports/v4/WF-02-home-mobile-light-drawer.png) | [png](exports/v4/WF-02-home-mobile-dark-drawer.png) |
| WF-03 기본 드로어 | [png](exports/v4/WF-03-folder-mobile-light-drawer.png) | [png](exports/v4/WF-03-folder-mobile-dark-drawer.png) |
| WF-04 기본 드로어 | [png](exports/v4/WF-04-litpage-mobile-light-drawer.png) | [png](exports/v4/WF-04-litpage-mobile-dark-drawer.png) |
| WF-02 상태 B 드로어(「문서」 없음) | [png](exports/v4/WF-02-home-mobile-light-state-B-drawer.png) | [png](exports/v4/WF-02-home-mobile-dark-state-B-drawer.png) |

### v4 수정(review-07 반영)

호배님 결정(2026-11-19 20:53 KST)에 따라 review-07의 major 2건만 고쳤다. minor 4건(WF-04 골격, WF-03 버튼 순서, 다크 그림자 고정값, WF-01 S의 WF-10 주석)은 손대지 않았다. 기존 `screens-wf01-04-v4.figcraft`를 열어 덮어썼고 새 토큰·컴포넌트는 없다.

**major 1 — WF-03 「기본 폴더 없음 안내」 복구**

- 문구: 「기본 폴더가 없으면 만들어 쓸 수 있습니다.」 (screen-data 「기본 폴더 없음 안내」의 「기본 폴더가 없으면 만들어 쓸 수 있다」를 화면 어미로 옮긴 것. 근거 FR-OSS-002, AC-FR-OSS-002-01, UF-02. 「기본값 사용」 예외 칸과 같은 내용.)
- 위치: `folder-picker-card` 안, 폴더 목록 아래·확인/취소 위. 14px `text-muted`(변수 바인딩, 라이트·다크 자동 전환). 레이어 이름 `hint-no-default-folder`.
- 프레임 8개: WF-03 기본·상태 A × 데스크톱·모바일 × 라이트·다크. 드로어 2장은 이 안내가 보일 이유가 없어 그대로 둔다.
- 만들기 버튼·폴더 생성 화면은 그리지 않았다. 폴더 생성 UI는 screen-data에서 [미확인]이므로 안내 문구만 복구했다(시각적 만들기 동선 제안 없음).

**major 2 — 구성 근거와 화면을 같은 결정으로 일치**

- **메달리온 사용 범위: 홈만이 아니라 「서비스·상태 표지」로 넓힌다.** 이유: WF-03 보조 패널의 Litpage 표지와 WF-04 작업 영역·차단 카드의 메달리온은 사용자가 「지금 어느 서비스·어떤 상태인가」를 한눈에 알게 한다. 이를 빼면 WF-03·04의 위계가 약해지고 WF-02에서 이어지는 서비스 정체성이 끊긴다. 대신 폼·목록·알림 안에는 쓰지 않는다는 한계를 두어 장식 남용을 막는다. 공통 구성 원리 문장을 이 범위로 고쳤고 화면은 바꾸지 않았다.
- **WF-03 상태 A 알림 위치: 데스크톱은 보조 패널 맨 위, 모바일은 확인·취소 버튼 바로 아래 안내 묶음 맨 위.** 이유: 이 알림은 「확인하면 무엇이 달라지는가」를 알리는 내용이라 경로 → 목록 → 확인의 선택 흐름 위에 얹으면 입력 순서를 끊고, 데스크톱에서는 같은 설명을 담는 보조 패널과 한곳에 모인다. 모바일은 한 열이라 확인 버튼 바로 아래가 시선이 닿는 자리다. 원칙은 같다: 알림은 선택 카드 안이나 경로 띠 위가 아니라 확인 결과를 설명하는 보조 영역에 둔다. 구성 근거의 「경로 띠 위에 추가된다」를 이 위치로 고쳤고 화면은 바꾸지 않았다.
- 결과적으로 화면이 아니라 문서가 틀려 있었다. 화면을 후퇴시키지 않았다.

**다시 내보낸 PNG (`exports/v4/`, 같은 파일명 8장)**

- WF-03-folder-desktop-light.png · WF-03-folder-desktop-dark.png
- WF-03-folder-desktop-light-state-A.png · WF-03-folder-desktop-dark-state-A.png
- WF-03-folder-mobile-light.png · WF-03-folder-mobile-dark.png
- WF-03-folder-mobile-light-state-A.png · WF-03-folder-mobile-dark-state-A.png

공통 구성 원리·WF-03 구성 근거·프레임 표(기본·A)·스킬 적용 기록의 메달리온 문장은 위 결정에 맞춰 고쳤다.

### v4 한계

- 글꼴: 헤드리스 FigCraft에 IBM Plex Sans KR이 없어 한글과 일부 라틴 굵기는 대체 글꼴로 렌더링된다(DS와 같은 제약). 워드마크는 DS 로고 윤곽을 그대로 썼다.
- 호버·포커스·눌림·로딩 상태, 실제 모바일 기기의 소형 폭(320) 검사는 이번 범위에 없다. 대비는 토큰 값 그대로 사용했고 화면별로 다시 측정하지 않았다 [미확인].
- 카드 그림자 색은 변수에 묶지 않은 고정 값이다(다크에서도 같은 색).
- 64장 PNG는 내보냈으나 장면별로 모두 육안 검토하지는 못했다. 기본 프레임과 대표 상태는 확인했다.
- 가운데 정렬 구성이라 WF-02 상태 B와 WF-03은 본문 아래 여백이 비교적 넓다. 기획에 없는 기능을 채우지 않는 선택이다.

---

## WF-05~08 (P3-4 · 두 번째 묶음) · v4 시각 언어

호배님이 2026-11-19 21:06 KST에 WF-01~04 v4를 확정하고 WF-05~16을 같은 방식으로 진행하라고 했다. 이 절은 **WF-05~08만** 다룬다. 기준은 develop `4b66d1d`의 기획 v1.0(DEC-081), 기능 범위는 `screen-data-actions.md`의 WF-05~08과 공통 헤더·푸터다. 새 빈 파일 [screens-wf05-08.figcraft](screens-wf05-08.figcraft)에서 시작했다(이전 세션의 `file.new`는 디스크에 파일이 남지 않아 이번 세션에서 새로 만들고 저장했다). v1~v3의 FigCraft·PNG·절은 열지 않았다. v4 파일·절·PNG는 읽기만 했고 복사하지 않았다(헤더·푸터·메달리온·알림은 v4의 규칙에 따라 새로 그렸다). 라이트/다크는 디자이너용 시안이며 테마 선택기(Q-090)는 어느 프레임에도 두지 않았다(DEC-101). 터치·모바일에서는 마우스 올림 썸네일을 생략했다(DEC-084). 텍스트 4.5:1, UI·포커스·필수 경계 3:1을 목표로 토큰 쌍을 골랐다(DEC-102, 화면별 실측은 [미확인]).

### v4에서 이어받은 것

일반 회원 헤더·푸터와 모바일 헤더 드로어(닫기, 프로필·로그아웃, 관리 없음, 테마 선택기 없음). `bg` → `surface`(캔버스) → `surface-raised`(카드) 표면 3단. 아치 메달리온은 **서비스·상태 표지**에만(WF-05 왼쪽 메뉴의 서비스 표지, 빈 폴더·빈 휴지통·차단 카드), 폼·목록·알림 안에는 쓰지 않는다. 금색 `accent`는 장식(수면선 한 줄, 메달리온 점)에만, 텍스트에는 쓰지 않는다. 오류·경고 아이콘은 `error` 토큰. 알림은 선택·목록·확인 흐름을 끊지 않는 보조 영역에 둔다. 데스크톱 1440(본문 최대 1120, 가운데), 모바일 360(좌우 16), 터치 44px. WF-08만 비회원 헤더 변형(로그인 버튼, 로고·카테고리·서비스 전환·로그인은 모두 WF-01).

### 구성 근거 (그리기 전에 작성)

#### WF-05 나루 드라이브

- **주요 목표:** 지금 폴더에서 파일을 찾고, 올리고, 정리하고, 공유한다. 삭제해도 이 화면에 머문다.
- **정보 위계:** (1) 현재 위치(경로)와 두 주 동작(올리기 primary, 폴더 만들기 secondary) (2) 항목 목록(이름 → 종류 → 크기 → 수정일 → 공유 여부) (3) 선택한 항목의 동작(이름 변경·이동·내려받기·회원 공유·링크 공유·삭제) (4) 왼쪽 메뉴(내 드라이브·휴지통) (5) 푸터.
- **구성:** **서재 + 목록대.** 왼쪽 240 열은 서비스 표지(아치 메달리온 + 「나루 드라이브」)와 메뉴 두 개(내 드라이브·휴지통)를 가진 보조 패널이고, 오른쪽 848 열(1120 − 240 − 간격 32)이 작업 영역이다. 작업 영역은 위에 경로와 두 주 동작, 가운데에 한 장의 목록 카드(`surface-raised`, 열 머리와 행 구분선은 장식 `border`), 목록 바로 위에 선택 동작 띠로 이루어진다. 목록 카드가 열을 가득 채우므로 1440에서 빈 면이 없고, 항목이 늘어도 행만 늘어난다. 썸네일은 데스크톱에서만 마우스를 올린 행 옆 작은 미리보기로 보이고(한 행만), 모바일은 형식 아이콘만 쓴다. 파일 형식은 DS 아이콘(문서·이미지·PDF·압축 등)으로 구분하고 PDF는 레이블을 병기한다. 휴지통은 헤더나 도구 띠가 아니라 왼쪽 메뉴에만 둔다(AC-FR-DRV-004-04). 모바일은 왼쪽 메뉴를 목록 위 두 칸짜리 분할 탭(내 드라이브·휴지통, 44px)으로 접고, 목록은 이름·보조 한 줄(종류·크기·수정일)·공유 표지로 줄인다. 상태 A 빈 폴더는 목록 자리에 메달리온 빈 상태(만들기·올리기 안내, 총용량 초과 안내 없음), B는 올리기 알림을 제목 줄 바로 아래, 선택 동작 띠와 목록 카드 바깥의 알림 줄에 둔다(목록·선택 흐름을 끊지 않고 둘 다 그대로 보인다). C는 폴더 만들기·이름 변경·이동의 실패 안내를 같은 알림 줄에(입력 UI가 [미확인]이라 대화상자는 그리지 않았다), D는 링크 공유 설정 오버레이(스위치, 다운로드 허용), E는 Litpage 문서 열기 불가 안내.
- **이끈 스킬 규칙:** design-taste(양쪽 가장자리 정렬, 빈 화면 금지, 목록 카드가 열을 채움), ui-ux-pro-max(화면당 primary 하나, `confirmation-dialogs`·`undo-support`는 삭제 확인이 [미확인]이라 구현하지 않고 질문으로 남김, `error-recovery`, `empty-states`, `touch-target-size`), hallmark(표면 사다리, 라벨은 본문 글꼴·소문자 격, 카드 안 카드 금지, 상태점·가운뎃점 메타 금지), web-design-guidelines(아이콘 전용 버튼 접근 이름, 오류는 인라인, `…`, 숫자는 tabular), frontend-design(대담함은 한 곳: 서비스 표지 메달리온).

#### WF-06 휴지통

- **주요 목표:** 삭제한 항목을 30일 안에 원래 위치로 복원한다. 남은 기간을 한눈에 안다.
- **정보 위계:** (1) 「30일 후 자동 삭제되고 공유 링크는 차단됩니다」 안내 (2) 목록(이름·종류·크기·자동 삭제까지 남은 기간·원래 위치) (3) 복원 동작. 영구 삭제·비우기는 기획에 없어 그리지 않는다.
- **구성:** **WF-05와 같은 서재 틀.** 왼쪽 메뉴는 그대로 두고 「휴지통」이 선택된 상태로 이어져 「왼쪽 메뉴로만 진입」이 보인다. 작업 영역 위에 안내 띠(정보, 아이콘만 `info`)가 있고, 목록은 WF-05와 같은 카드이되 열이 다르다(수정일 대신 남은 기간, 원래 위치 추가). 복원 대상 선택 방식은 [미확인]이라 WF-05와 같은 선택 동작 띠에 「원래 위치로 복원」 하나만 둔다. 남은 기간은 「23일 남음」처럼 숫자와 단위를 함께 쓰고 색으로 긴급도를 나누지 않는다(이전 초안의 「7일 이하 경고 표시」는 기획에 없는 기준이라 만들지 않았다). 상태 A 빈 휴지통은 메달리온 빈 상태, B는 30일이 지나 복원할 수 없는 항목의 오류 안내(원인 + 다음 행동).
- **이끈 스킬 규칙:** ui-ux-pro-max(`color-not-decorative-only`, `empty-states`, `error-clarity`), hallmark(영구 삭제 같은 위험 동작을 만들지 않음, 한 화면 한 primary), design-taste(화면 틀 반복으로 위계 학습), web-design-guidelines(숫자 `tabular-nums`).

#### WF-07 회원 공유

- **주요 목표:** 소유자가 한 파일을 이메일로 찾은 활동 회원에게 권한(보기/편집)과 다운로드 허용을 정해 공유하고, 공유 중인 회원을 취소한다.
- **정보 위계:** (1) 대상 파일 (2) 이메일 입력 → 찾기 → 찾은 회원 (3) 권한·다운로드 (4) 공유 (5) 공유 중인 회원 목록(공유 취소).
- **구성:** **두 단 공유대.** 폭 1120(다른 화면과 같은 좌우 선)의 한 카드가 두 패널(왼쪽 560 / 오른쪽 나머지)로 나뉜다. 왼쪽은 「새로 공유」(파일 이름 띠, 이메일 필드 + 찾기, 찾은 회원, 권한 라디오, 다운로드 허용 체크, 공유 primary), 오른쪽은 「공유 중인 회원」 목록(표시 이름·권한·다운로드 허용·공유 취소). 입력에서 결과까지 한 방향으로 읽히고 오른쪽이 결과를 확인하는 자리다. 닫기가 WF-05로 돌아가는지는 [미확인]이어서 제목 줄 오른쪽에 「닫기」 버튼(모바일은 X 아이콘 버튼, 접근 이름 「닫기」) 하나만 두고 도착 화면은 열린 질문으로 남긴다. 모바일은 한 열로 쌓는다. 상태 A는 필드 아래 인라인 오류(활동 회원 없음: 정지·탈퇴 포함, 다음 행동 안내), B는 같은 위치의 자기 자신 안내. 빈 공유 목록 UI는 [미확인]이라 그리지 않고 열린 질문으로 남긴다(모든 프레임의 공유 중 목록은 회원 3명이 있는 예시다).
- **이끈 스킬 규칙:** ui-ux-pro-max(`error-placement`, `input-labels`, `error-recovery`, `required-indicators`), web-design-guidelines(필드 라벨, `type="email"`·`autocomplete="off"`·`spellcheck=false`, 오류는 인라인), hallmark(라디오·체크는 라벨과 한 타깃, 한 primary), design-taste(두 패널 가장자리 정렬).

#### WF-08 링크 보기

- **주요 목표:** 비회원이 링크로 받은 파일을 보기만 한다. 허용되면 내려받는다. 열 수 없으면 이유를 안다.
- **정보 위계:** (1) 파일 보기 영역 (2) 「보기 전용」 안내 (3) 다운로드(허용일 때만) (4) 비회원 헤더의 로그인.
- **구성:** **열람대.** 비회원 헤더(로고·카테고리·서비스 전환·로그인 버튼) 아래, 폭 1120 한 장의 큰 보기 영역과 그 위 얇은 정보 띠(파일 이름·크기는 [미확인]이라 「파일 이름·크기 [미확인]」 라벨 자리, 「보기 전용」 표지, 다운로드 버튼)로 이루어진다. 편집 동작은 없다. 상태 A는 다운로드 불허로 버튼이 없는 띠, 상태 B는 보기 영역이 차단 카드(메달리온, 안내 `[문구 미확정]`, 사유별 구분 [미확인])로 바뀐다. 모바일은 띠가 위, 보기 영역이 아래 한 열이다. 비회원 헤더는 로그인 primary를 하나만 둔다.
- **이끈 스킬 규칙:** design-taste(큰 보기 영역이 캔버스를 채움), ui-ux-pro-max(`primary-action`, 비활성 대신 버튼 자체를 숨기는 기획 반영), frontend-design(차단 메달리온은 상태 표지), web-design-guidelines(링크는 링크, 로그인은 버튼).

### 스킬 적용 기록

| 스킬 | 로드 방법 | 읽은 파일 | 가져온 규칙·권고 | 반영한 화면·상태 |
| --- | --- | --- | --- | --- |
| frontend-design | Skill 도구 | 플러그인 `SKILL.md`(Skill 호출 결과) | 제품 주제에서 모티프를 끌어온다. 한 곳에만 대담함을 쓴다. 장식 라벨·한 단어 강조 금지. 오류·빈 상태는 원인과 다음 행동. | WF-05 서비스 표지 메달리온, 빈 폴더·빈 휴지통·차단 카드, 전 화면 오류 문구 |
| design-taste-frontend | Skill 도구, `references/layout-v4.md` Read | `SKILL.md`, `layout-v4.md` | 제품 앱이므로 마케팅 히어로·셰이더·사진 규칙은 제외. 양쪽 가장자리 정렬, 빈 화면 금지, 한 줄을 채우는 카드, 위계, 반슬롭. | 1120 가운데 정렬, 목록 카드·열람 영역이 열을 채움 |
| ui-ux-pro-max | Skill 도구, `references/quick-reference.md` Read | `SKILL.md`, `quick-reference.md` | 생산성·SaaS: 절제된 신뢰 블루. 대비 4.5:1, 터치 44, 간격 8, 화면당 primary 하나, 오류는 필드 근처에 원인+복구, 빈 상태는 행동 제안, 색만으로 의미 전달 금지, 위험 동작 확인. 팔레트 hex는 쓰지 않고 Deep Ink 유지. | 전 화면 버튼 위계, WF-06 남은 기간 표시, WF-07 오류 |
| hallmark | Skill 도구, `references/gates.md` Read | `SKILL.md`, `gates.md` | 라벨은 본문 글꼴 한 단계 작게·대문자 아님, 이모지·장식 상태점·가운뎃점 메타 금지, 카드 안 카드 금지, 다크는 재도출·명도 단계, 한 화면 약 80단어, 가짜 수치·가짜 사진 금지. 마케팅 히어로·lint 규칙은 이식하지 않음(lint 미실행). | 목록 카드, 푸터 링크, 다크 프레임, 화면당 문구량 |
| web-design-guidelines | Skill 도구, 프롬프트 인라인 규칙 | `SKILL.md` + 인라인 규칙(네트워크 미사용) | 아이콘 전용 버튼 접근 이름, 폼 라벨·`type`·`autocomplete`·`spellcheck`, 오류 인라인, `…`, `tabular-nums`, 링크는 링크·버튼은 버튼, 파괴적 동작 확인(삭제 확인은 [미확인]), 한국어 문구 우선. | 행 작업 버튼, WF-07 필드, WF-06 남은 기간 숫자(「23일 남음」 단위 포함, `tnum` 기능은 FigCraft에서 적용하지 않음 [미확인]), WF-08 로그인 |

이번 세션에서 스킬 다섯 개를 모두 Skill 도구로 다시 호출했고, 다음 참조를 Read로 열었다: design-taste-frontend `references/layout-v4.md`, ui-ux-pro-max `references/quick-reference.md`, hallmark `references/gates.md`·`references/craft.md`. `search.py`·`gate.mjs`·`sloplint.mjs`·네트워크는 쓰지 않았다. 스킬의 lint·게이트·마케팅 히어로 규칙은 실행하지 않았고 구성·표면·타이포·접근성 판단 기준으로만 썼다. ui-ux-pro-max의 `pro-rules.md`·CSV 데이터와 frontend-design의 다른 파일은 이번에 열지 않았다.

### 이번 세션의 초안 점검

- 이어 쓴 것: 화면별 주요 목표·정보 위계, 알림 위치 원칙, 스킬 적용 기록 틀. 그린 결과와 어긋난 부분만 고쳤다(위 본문의 열 폭 848, 알림 줄 위치, WF-06 「7일 이하 경고」 삭제, WF-07 카드 폭 1120과 닫기 위치, 빈 공유 목록 미작도, WF-08 파일 이름 라벨).
- 이전 세션의 「새로 그렸다」는 문장은 디스크에 파일이 없어 사실이 아니었다. 이번 세션에서 새 빈 파일로 만들었고 v4 파일은 읽기·스크린샷만 했다(v4 헤더 구조는 읽고 새로 그렸다).

### WF-05~08 프레임과 상태 (WF · FR/AC · 상태)

기본 + 상태를 데스크톱·모바일 × 라이트·다크로 그렸다. 합계 **66개** = 데스크톱 30(기본·상태 15 × 라이트·다크) + 모바일 30(같은 구성) + 모바일 헤더 드로어 6(WF-05·06·07 × 라이트·다크). 데스크톱 1440×900, 모바일 폭 360(높이는 내용에 맞춤, 상태 D 모바일과 드로어는 360×800 뷰포트). 라이트·다크는 같은 구조에 변수 컬렉션 `Deep Ink`의 Light/Dark 모드만 바꿨다.

| WF | 상태 | 관련 FR / AC | 화면 내용 |
| --- | --- | --- | --- |
| WF-05 나루 드라이브 | 기본 | FR-DRV-001~008 · AC-FR-DRV-001-03, AC-FR-DRV-004-04 | 서비스 표지(아치 메달리온)와 왼쪽 메뉴(내 드라이브·휴지통), 현재 위치(경로·폴더 이름), 폴더 만들기·올리기, 선택 동작 띠, 목록(이름·종류·크기·수정일·공유 여부). 데스크톱은 마우스 올린 행 옆(이름과 「종류」 열 사이 여백)에 작은 미리보기 썸네일 한 개, 모바일은 형식 아이콘만. 모바일은 헤더 아래에 작은 서비스 표지(소형 아치 메달리온 + 「나루 드라이브」) 한 줄이 있다 |
| WF-05 | A 빈 폴더 | AC-FR-DRV-001-02 | 목록 자리에 메달리온 빈 상태. 만들기·올리기 안내와 파일당 1GB. 총용량 초과 안내 없음 |
| WF-05 | B 1GB 초과·올리기 실패 | AC-FR-DRV-003-02, AC-NFR-PERF-002-01 | 알림 줄(`error` 아이콘), 목록 유지, 문구 `[문구 미확정]` |
| WF-05 | C 폴더 변경 불가 | AC-FR-DRV-002-02 | 같은 알림 줄(빈 이름·중복·자기 자신 아래 이동), 입력 UI는 그리지 않음 [미확인] |
| WF-05 | D 링크 공유 설정 | AC-FR-DRV-007-01·02 | 데스크톱 대화상자(`scrim`), 모바일 하단 시트(보이는 닫기 버튼). 링크 공유 켜짐, 다운로드 허용, 만료·비밀번호 없음. 링크 주소 표시·복사 UI는 점선 슬롯 [미확인] |
| WF-05 | E Litpage 문서 열기 불가 | AC-FR-DRV-005-02 | 같은 알림 줄. 파일은 드라이브에서 그대로 볼 수 있다는 안내 `[문구 미확정]` |
| WF-05 | 모바일 드로어 | FR-SHELL-001 | 닫기·서비스 전환·카테고리·프로필·로그아웃. 관리 항목·테마 선택기 없음 |
| WF-06 휴지통 | 기본 | FR-DRV-004 · AC-FR-DRV-004-02·03·05 | 왼쪽 메뉴에서 「휴지통」 선택, 30일·링크 차단 안내(정보 알림), 선택 동작 띠의 「원래 위치로 복원」(primary 하나), 목록(이름·종류·크기·자동 삭제까지·원래 위치). 영구 삭제·비우기 없음 |
| WF-06 | A 빈 휴지통 | AC-FR-DRV-004-05 | 메달리온 빈 상태 |
| WF-06 | B 30일 경과 복원 불가 | AC-FR-DRV-004-02 | 알림 줄, 이미 자동 삭제되어 되살릴 수 없다는 안내 `[문구 미확정]`. 오류가 가리키는 파일(견적서 v1.pdf)이 선택된 행이고(남은 기간 칸 「30일 경과」), 「원래 위치로 복원」은 비활성(`surface` 바탕·`text-muted` 글자)이다 |
| WF-06 | 모바일 드로어 | FR-SHELL-001 | WF-05와 같은 구성 |
| WF-07 회원 공유 | 기본 | FR-DRV-006 · AC-FR-DRV-006-01·03·04 | 대상 파일, 이메일 입력·찾기, 찾은 활동 회원, 권한(보기/편집)·다운로드 허용, 공유(primary), 공유 중인 회원 목록과 공유 취소, 닫기 |
| WF-07 | A 활동 회원 없음 | AC-FR-DRV-006-02 | 필드 아래 인라인 오류(정지·탈퇴 포함), 찾은 회원 없음, 공유 비활성 `[문구 미확정]` |
| WF-07 | B 자기 자신에게 공유 | AC-FR-DRV-006-03 | 같은 위치의 오류, 공유 비활성 `[문구 미확정]` |
| WF-07 | 모바일 드로어 | FR-SHELL-001 | WF-05와 같은 구성 |
| WF-08 링크 보기 | 기본 | FR-DRV-007 · AC-FR-DRV-007-01, AC-FR-SHELL-001-05 | 비회원 헤더(로그인 버튼, 문구 `[문구 미확정]`), 파일 정보 띠(이름·크기 라벨 [미확인], 「보기 전용」 표지, 다운로드), 보기 영역 플레이스홀더. 편집 동작 없음 |
| WF-08 | A 다운로드 불허 | AC-FR-DRV-007-01 | 다운로드 버튼 없음, 안내 `[문구 미확정]` |
| WF-08 | B 링크를 열 수 없음 | AC-FR-DRV-007-02, AC-FR-DRV-004-03 | 파일 정보 띠 없이 차단 카드(메달리온, 사유별 구분 없음 [미확인]) `[문구 미확정]` |

공통 헤더(일반 회원, WF-05~07)·비회원 헤더(WF-08)·푸터(이용약관, 개인정보처리방침, 오픈소스 라이선스 고지, 문의 `aslanhobae@gmail.com`, `Dev. Aslan0`, 회사 정보 없음)는 모든 프레임에 있다. 테마 선택기(Q-090)는 어디에도 두지 않았다. 로딩 화면은 기획에 없어 만들지 않았다.

### 그린 결과의 구성 요약

- **표면과 장치(v4 이어받음).** `surface` 바탕, `surface-raised` 카드, 헤더·푸터 `bg` 전폭 띠, 본문 폭 1120 가운데. 아치 메달리온은 WF-05 서비스 표지와 빈 폴더·빈 휴지통·보기 영역·차단 카드에만, 금색은 메달리온 수면선 한 줄뿐이다. 오류·경고 아이콘은 `error`, 정보 아이콘은 `info`, 알림 본문은 `text`. 목록·폼·알림 안에는 메달리온을 쓰지 않았다.
- **WF-05·06.** 왼쪽 240 메뉴(서비스 표지 + 두 항목)와 오른쪽 작업 영역. 휴지통은 헤더가 아닌 왼쪽 메뉴로만 들어간다. 선택된 행은 `info-subtle` 바탕에 `primary` 2px 테두리로 표시해 색만으로 구분하지 않는다(행 선택 방식 자체는 [미확인]). 모바일은 헤더 아래 작은 서비스 표지(소형 아치 메달리온 + 「나루 드라이브」, 데스크톱 표지의 축소형)가 서비스를 알리고, 두 칸 분할 탭이 왼쪽 메뉴를 대신하며 행은 이름·보조 한 줄·공유 표지·더 보기(44px)로 줄였다.
- **WF-07.** 왼쪽 「새로 공유」(입력 → 찾기 → 찾은 회원 → 권한·다운로드 → 공유)에서 오른쪽 「공유 중인 회원」으로 한 방향으로 읽힌다. 화면당 primary는 「공유」 하나. 모바일은 한 열로 쌓고 공유 중 목록을 아래에 둔다.
- **WF-08.** 비회원 헤더의 primary는 「로그인」 하나. 보기 영역이 남는 높이를 채워 빈 화면이 생기지 않는다.

### PNG 파일 링크 표 (`exports/wf05-08/`)

| 화면·상태 | 데스크톱 라이트 | 데스크톱 다크 | 모바일 라이트 | 모바일 다크 |
| --- | --- | --- | --- | --- |
| WF-05 기본 | [png](exports/wf05-08/WF-05-drive-desktop-light.png) | [png](exports/wf05-08/WF-05-drive-desktop-dark.png) | [png](exports/wf05-08/WF-05-drive-mobile-light.png) | [png](exports/wf05-08/WF-05-drive-mobile-dark.png) |
| WF-05 A | [png](exports/wf05-08/WF-05-drive-desktop-light-state-A.png) | [png](exports/wf05-08/WF-05-drive-desktop-dark-state-A.png) | [png](exports/wf05-08/WF-05-drive-mobile-light-state-A.png) | [png](exports/wf05-08/WF-05-drive-mobile-dark-state-A.png) |
| WF-05 B | [png](exports/wf05-08/WF-05-drive-desktop-light-state-B.png) | [png](exports/wf05-08/WF-05-drive-desktop-dark-state-B.png) | [png](exports/wf05-08/WF-05-drive-mobile-light-state-B.png) | [png](exports/wf05-08/WF-05-drive-mobile-dark-state-B.png) |
| WF-05 C | [png](exports/wf05-08/WF-05-drive-desktop-light-state-C.png) | [png](exports/wf05-08/WF-05-drive-desktop-dark-state-C.png) | [png](exports/wf05-08/WF-05-drive-mobile-light-state-C.png) | [png](exports/wf05-08/WF-05-drive-mobile-dark-state-C.png) |
| WF-05 D | [png](exports/wf05-08/WF-05-drive-desktop-light-state-D.png) | [png](exports/wf05-08/WF-05-drive-desktop-dark-state-D.png) | [png](exports/wf05-08/WF-05-drive-mobile-light-state-D.png) | [png](exports/wf05-08/WF-05-drive-mobile-dark-state-D.png) |
| WF-05 E | [png](exports/wf05-08/WF-05-drive-desktop-light-state-E.png) | [png](exports/wf05-08/WF-05-drive-desktop-dark-state-E.png) | [png](exports/wf05-08/WF-05-drive-mobile-light-state-E.png) | [png](exports/wf05-08/WF-05-drive-mobile-dark-state-E.png) |
| WF-06 기본 | [png](exports/wf05-08/WF-06-trash-desktop-light.png) | [png](exports/wf05-08/WF-06-trash-desktop-dark.png) | [png](exports/wf05-08/WF-06-trash-mobile-light.png) | [png](exports/wf05-08/WF-06-trash-mobile-dark.png) |
| WF-06 A | [png](exports/wf05-08/WF-06-trash-desktop-light-state-A.png) | [png](exports/wf05-08/WF-06-trash-desktop-dark-state-A.png) | [png](exports/wf05-08/WF-06-trash-mobile-light-state-A.png) | [png](exports/wf05-08/WF-06-trash-mobile-dark-state-A.png) |
| WF-06 B | [png](exports/wf05-08/WF-06-trash-desktop-light-state-B.png) | [png](exports/wf05-08/WF-06-trash-desktop-dark-state-B.png) | [png](exports/wf05-08/WF-06-trash-mobile-light-state-B.png) | [png](exports/wf05-08/WF-06-trash-mobile-dark-state-B.png) |
| WF-07 기본 | [png](exports/wf05-08/WF-07-member-share-desktop-light.png) | [png](exports/wf05-08/WF-07-member-share-desktop-dark.png) | [png](exports/wf05-08/WF-07-member-share-mobile-light.png) | [png](exports/wf05-08/WF-07-member-share-mobile-dark.png) |
| WF-07 A | [png](exports/wf05-08/WF-07-member-share-desktop-light-state-A.png) | [png](exports/wf05-08/WF-07-member-share-desktop-dark-state-A.png) | [png](exports/wf05-08/WF-07-member-share-mobile-light-state-A.png) | [png](exports/wf05-08/WF-07-member-share-mobile-dark-state-A.png) |
| WF-07 B | [png](exports/wf05-08/WF-07-member-share-desktop-light-state-B.png) | [png](exports/wf05-08/WF-07-member-share-desktop-dark-state-B.png) | [png](exports/wf05-08/WF-07-member-share-mobile-light-state-B.png) | [png](exports/wf05-08/WF-07-member-share-mobile-dark-state-B.png) |
| WF-08 기본 | [png](exports/wf05-08/WF-08-link-desktop-light.png) | [png](exports/wf05-08/WF-08-link-desktop-dark.png) | [png](exports/wf05-08/WF-08-link-mobile-light.png) | [png](exports/wf05-08/WF-08-link-mobile-dark.png) |
| WF-08 A | [png](exports/wf05-08/WF-08-link-desktop-light-state-A.png) | [png](exports/wf05-08/WF-08-link-desktop-dark-state-A.png) | [png](exports/wf05-08/WF-08-link-mobile-light-state-A.png) | [png](exports/wf05-08/WF-08-link-mobile-dark-state-A.png) |
| WF-08 B | [png](exports/wf05-08/WF-08-link-desktop-light-state-B.png) | [png](exports/wf05-08/WF-08-link-desktop-dark-state-B.png) | [png](exports/wf05-08/WF-08-link-mobile-light-state-B.png) | [png](exports/wf05-08/WF-08-link-mobile-dark-state-B.png) |

모바일 드로어(360×800, WF-08은 비회원 헤더라 없음)

| 화면 | 라이트 | 다크 |
| --- | --- | --- |
| WF-05 드로어 | [png](exports/wf05-08/WF-05-drive-mobile-light-drawer.png) | [png](exports/wf05-08/WF-05-drive-mobile-dark-drawer.png) |
| WF-06 드로어 | [png](exports/wf05-08/WF-06-trash-mobile-light-drawer.png) | [png](exports/wf05-08/WF-06-trash-mobile-dark-drawer.png) |
| WF-07 드로어 | [png](exports/wf05-08/WF-07-member-share-mobile-light-drawer.png) | [png](exports/wf05-08/WF-07-member-share-mobile-dark-drawer.png) |

`exports/wf05-08/.keep`은 export 폴더 생성을 위한 플레이스홀더다.

### 새 토큰·컴포넌트 제안

새 색 토큰은 없다. 쓴 변수는 `bg`, `surface`, `surface-raised`, `surface-hover`, `text`, `text-muted`, `border`, `border-strong`, `primary`, `on-primary`, `accent`, `error`, `error-subtle`, `info`, `info-subtle`, `overlay`, `scrim`뿐이다(DS 값 그대로, 파일에는 22개 변수만 옮겼다). 아래는 DS에 반영하지 않은 제안이다.

- **File list row의 선택 표시**: 선택 행을 `info-subtle` 바탕 + `primary` 2px 테두리로 표시했다. DS의 File list row `selected`와 맞출 필요가 있다.
- **선택 동작 띠(Selection actions bar)**: 선택된 항목의 동작(이름 변경·이동·내려받기·회원 공유·링크 공유·삭제 / 휴지통은 복원)을 목록 위 한 줄로 모았다. 선택 방식 [미확인]이므로 제안이다.
- **Inline alert 3종 배치**: `error-subtle` 바탕에 `error` 아이콘, `info-subtle` 바탕에 `info` 아이콘, 본문은 `text`. WF-07은 필드 아래 인라인 오류(텍스트 `error`).
- **Arch medallion**(v4 제안 승격 검토): 80×96, 빈 상태·보기 영역·차단 카드에도 같은 규격을 썼다. 서비스 표지용 56×64 소형도 썼다.
- **Toggle·Radio·Checkbox·Avatar**: DS 인벤토리에 있는 컴포넌트를 이번 파일에는 시안용 프레임으로 다시 그렸다. 체크 표시용 `check`의 `on-primary` 변형 아이콘이 필요하다.
- **모바일 하단 시트(링크 공유)**: 데스크톱 대화상자와 같은 내용을 아래에서 올라오는 시트로 바꿨다. DS의 Bottom sheet(파일·휴지통 복원)에는 링크 공유 변형이 없다.

### 열린 기획 질문 (모두 기획 확인 필요)

- **WF-05**: 삭제 확인 방식(확인 대화상자·되돌리기), 항목 선택 방식과 동작 노출 위치(데스크톱 띠·모바일 더 보기 시트), 폴더 만들기·이름 변경·이동의 입력 UI, 링크 주소 표시·복사 UI, 길게 이어진 이름 처리, 폴더 크기·날짜·시간대 표기, 공유 여부의 회원/링크 구분, 업로드 진행·로딩·썸네일 준비 중 표시, 모바일의 썸네일 대체(DEC-084 기준 생략으로 그림), 상태 B·C·E 문구.
- **WF-06**: 복원 대상 선택 방식, 원래 폴더가 사라졌을 때의 복원 위치, 복원 실패·로딩 표현, 남은 기간 표기 단위, 상태 B 문구.
- **WF-07**: 닫기의 도착 화면(WF-05인지), 빈 공유 목록 UI, 권한의 기본 선택(시안은 보기), 다운로드 허용의 편집 권한 시 표시, 상태 A·B 문구, 로딩·오류.
- **WF-08**: 파일 이름·크기 표시 여부, 열 수 있는 형식의 범위, 사유별 안내 구분, 상태 A·B 문구, 로그인 버튼 문구와 로그인 후 복귀 위치.
- **공통**: Q-090 테마 선택기 위치(어느 프레임에도 두지 않음), 모바일 헤더·푸터 배치의 기획 확정 여부.

### review-09 반영 (WF-05~08 수정)

호배님 지시(2026-11-19 22:58 KST)에 따라 review-09 지적 7건 중 **경미 4를 뺀 6건**만 고쳐 다시 그렸다. 부분 수정이며 나머지 레이아웃·문구·컴포넌트는 그대로다.

| # | 지적 | 수정 |
| --- | --- | --- |
| 1 (major) | WF-05 데스크톱 호버 썸네일이 「종류」 열을 가림 | 썸네일을 184×128에서 152×104로 줄여 호버 행의 이름과 「종류」 열 사이 여백으로 옮겼다. 열 텍스트를 가리지 않는다. 모바일에는 호버 썸네일을 넣지 않았다(DEC-084) |
| 2 (major) | WF-08 모바일 비회원 헤더의 용도 없는 햄버거 | 공통 컴포넌트 `header-guest-mobile`에서 메뉴 버튼(`ic/menu`)을 지워 6장에 반영했다. 로고와 로그인 버튼만 남았고 오른쪽 여백은 16px로 맞췄다. 회원 드로어는 만들지 않았다 |
| 3 (minor) | keep-all과 어긋난 음절 단위 줄바꿈 | 단어(조사 포함) 중간에서 끊기던 문구에 줄바꿈을 직접 넣었다. 문구 내용은 바꾸지 않았다. 대상: WF-05 상태 A(데스크톱·모바일)·B·C·E 모바일 알림, WF-06 모바일 안내·빈 상태, WF-07 A·B 오류와 모바일 도움말, WF-08 보기 영역·B 차단 안내(데스크톱·모바일 라이트·다크 짝 포함) |
| 4 (minor) | WF-05 상태 B·C·E에 남은 호버 배경 | 썸네일이 빠진 「현장 사진 03.jpg」 행의 `surface-hover` 바탕을 없앴다(데스크톱 B·C·E 라이트·다크 6장). 같은 잔여가 있던 상태 D의 배경 행도 함께 정리했다 |
| 5 (minor) | WF-05·06 모바일에 서비스 맥락 약함 | 모바일 프레임 헤더 아래 첫 줄에 소형 서비스 표지(36×40 아치 메달리온 + 「나루 드라이브」 16px)를 넣었다. WF-05 14장·WF-06 8장(기본·상태·드로어). 테마 선택기·관리 메뉴·새 기능 없음 |
| 6 (minor) | WF-06 상태 B 오류·선택 행·복원 버튼 불일치 | 오류 문구의 파일을 선택된 행과 같은 「견적서 v1.pdf」로 맞췄고, 그 행의 남은 기간을 「30일 경과」로 바꿨다. 「원래 위치로 복원」은 비활성 모양(`surface` 바탕, `border` 테두리, `text-muted` 글자)이다. 데스크톱·모바일 라이트·다크 4장 |

**경미 4는 호배님 지시에 따라 손대지 않았다.** WF-08 데스크톱 비회원 헤더 로그인 버튼 옆 `[문구 미확정]`이 모바일 헤더에 없는 점, 그 생략을 문서로 해명하는 일, 데스크톱 쪽 표시를 바꾸는 일 모두 하지 않았다.

**구성 근거를 화면에 맞춘 곳:** 위 프레임 표의 WF-05 기본·WF-06 B 행, 「그린 결과의 구성 요약」의 WF-05·06 문장(모바일 서비스 표지). 그 밖의 문장은 그대로다.

**다시 낸 PNG(`exports/wf05-08/`, 같은 파일명, 60장):**

- WF-05 데스크톱 12: `WF-05-drive-desktop-{light,dark}`, `…-state-A`, `-B`, `-C`, `-D`, `-E` 각 라이트·다크
- WF-05 모바일 14: `WF-05-drive-mobile-{light,dark}`, `…-state-A`~`-E`, `…-{light,dark}-drawer`
- WF-06 10: `WF-06-trash-desktop-{light,dark}-state-B`, `WF-06-trash-mobile-{light,dark}`, `…-state-A`, `-B`, `…-{light,dark}-drawer`
- WF-07 12: `WF-07-member-share-desktop-{light,dark}-state-A`, `-B`, `WF-07-member-share-mobile-{light,dark}`, `…-state-A`, `-B`, `…-{light,dark}-drawer`
- WF-08 12: `WF-08-link-desktop-{light,dark}`, `…-state-A`, `-B`, `WF-08-link-mobile-{light,dark}`, `…-state-A`, `-B`

이번 수정에서 눈으로 다시 확인한 PNG: WF-05 데스크톱 기본(라이트), WF-05 모바일 다크 C·다크 드로어, WF-06 모바일 라이트 B, WF-07 모바일 라이트 A, WF-08 모바일 다크 A. 나머지 재출력본은 같은 구조라 개별로 보지 않았다 [미확인]. 줄바꿈은 글자 수 기준으로 넣은 고정 줄바꿈이라 실제 구현 글꼴·폭에서는 다시 확인해야 한다 [미확인].

### WF-05~08 한계와 [미확인]

- 글꼴: 헤드리스 FigCraft에 IBM Plex Sans KR이 없어 한글은 대체 글꼴로 렌더링된다. 파일에는 IBM Plex Sans KR / IBM Plex Sans 지정이 남아 있다.
- 대비는 DS 대비표의 토큰 쌍을 그대로 따랐고 화면별로 다시 측정하지 않았다(DEC-102 충족 여부 화면 단위 [미확인]). 12·13px 보조 문구는 `text-muted`로 DS 표의 4.5:1을 넘는 쌍이다. 키보드 포커스·읽기 순서·터치 동작은 시안으로 검증할 수 없다 [미확인].
- 호버·눌림·포커스 상태 프레임, 업로드 진행·로딩 표현은 그리지 않았다. 마우스 올림 썸네일은 WF-05 기본 데스크톱 한 프레임에만 슬롯으로 그렸고 실제 이미지 축소본은 쓰지 않았다(가짜 사진 금지).
- 모바일에서 선택 항목의 동작(WF-05)은 행의 「더 보기」 버튼만 그렸고 그 메뉴·시트는 그리지 않았다 [미확인].
- 선택 동작 띠와 모바일 하단 시트는 디자인 제안이다. 화면당 한 화면이 기획 와이어프레임과 달라진 부분은 위 표와 제안에 적었다.
- 다크 프레임의 그림자는 DS 그림자 색을 라이트와 같은 값으로 고정했다(변수에 묶지 않음).
- 프레임 각각을 모두 육안으로 확인하지는 못했다. WF-05 기본·상태 A·B·D(데스크톱)과 모바일 기본·D·드로어, WF-06 기본·B(모바일), WF-07 A·B·모바일 기본, WF-08 기본·A·B(데스크톱)는 스크린샷으로 확인했다. 나머지 다크·모바일 상태 프레임은 같은 구조의 복제본이라 개별 확인을 하지 않았다 [미확인].

---

## WF-09~12 (P3-4 · 세 번째 묶음) · v4·WF-05~08 시각 언어

호배님이 2026-11-20 08:59 KST에 WF-05~08을 확정·커밋하고 WF-09~16을 같은 방식으로 진행하라고 했다. 이 절은 **WF-09~12만** 다룬다(WF-13 이후는 그리지 않고 WF-11 메뉴에 목적지만 표시). 기준은 develop `4b66d1d`의 기획 v1.0(DEC-081), 기능 범위는 `screen-data-actions.md`의 WF-09~12와 공통 헤더·푸터다. 새 빈 파일 [screens-wf09-12.figcraft](screens-wf09-12.figcraft)에서 시작했고 `Deep Ink` 변수 컬렉션(Light/Dark, 22개)만 새로 만들었다. 라이트/다크는 디자이너용 시안이며 테마 선택기(Q-090, DEC-101)는 어느 프레임에도 두지 않았다. 터치 기기는 마우스 올림 썸네일을 생략한다(DEC-084, 이 묶음에는 썸네일 화면 없음). 텍스트 4.5:1, UI·포커스·필수 경계 3:1을 목표로 DS 토큰 쌍만 골랐다(DEC-102, 화면별 실측은 [미확인]).

**열람 기록(정직성).** 이 파일 `screens.md`를 처음 열 때 앞부분의 v1~v3 절 텍스트(1~250행)가 함께 화면에 나왔다. 지시된 금지 대상은 v1~v3의 FigCraft 파일과 PNG이며 그것들은 열지 않았다. 다만 v1~v3 절 문장은 읽었고, 레이아웃 근거로 쓰지 않았다. WF-05~08 PNG는 헤더·드로어·푸터·메달리온·알림 일관성 확인용으로 4장(WF-05 기본 라이트, WF-05 모바일 라이트 드로어, WF-08 B 라이트, v4 WF-01 S 라이트)만 봤고 파일을 복사·복제하지 않았다.

### v4·WF-05~08에서 이어받은 것

일반 회원 헤더(72px)·푸터(60px, 이용약관·개인정보처리방침·오픈소스 라이선스 고지·문의 `aslanhobae@gmail.com`·`Dev. Aslan0`), 본문 폭 1120 가운데, 모바일 360(좌우 16, 44px 터치), 표면 `bg` → `surface` → `surface-raised`, 카드 그림자 1단계, 모바일 헤더 드로어(닫기, 서비스 전환, 카테고리, 프로필, 로그아웃, 테마 선택기 없음), 아치 메달리온은 서비스·상태 표지에만(폼·목록·알림 안 금지), 금색 `accent`는 수면선과 메달리온 점 같은 장식만, 오류 아이콘은 `error`.
**관리자 헤더 변형(이번에 처음):** 헤더 구성은 일반 회원과 같고 **회원 메뉴 항목만** 프로필·**관리**·로그아웃이다. 헤더 본체에 관리 바로가기를 따로 더하지 않았다(FRD 헤더 정의). 데스크톱은 WF-11에 회원 메뉴를 연 프레임을 추가해 항목 차이를 보이고, 모바일 드로어는 프로필·관리·로그아웃을 둔다. 일반 회원 화면(WF-09)에는 관리가 없다.

### 구성 근거 (그리기 전에 작성)

#### WF-09 탈퇴 확인

- **주요 목표:** 무엇을 잃고 무엇이 남는지 알고 나서 탈퇴하거나, 부담 없이 취소해 프로필(WF-16)로 돌아간다. 실수로 실행하지 않는다.
- **정보 위계:** (1) 「탈퇴 확인」 제목 (2) 탈퇴하면 일어나는 일(탈퇴 상태, 공유·링크는 보관 기간 유지) (3) 30일 보관 후 삭제·30일 안 재가입 시 복구의 시간 흐름 (4) 취소·탈퇴 확인 (5) 표시 이름 예약 안내 자리(기획 [미확인]).
- **구성:** **두 카드 + 시간선.** 폭 1120을 664 / 424로 나눈다. 왼쪽 카드는 읽을 내용과 두 동작(취소 secondary, 탈퇴 확인 위험 버튼)이고, 오른쪽 카드는 30일을 한눈에 보이는 세로 시간선(탈퇴 확인 → 보관 30일 → 데이터 삭제, 보관 구간에 「다시 가입하면 복구」)이다. 시간 순서가 실제로 있는 내용이라 시간선만 번호 없이 선과 점으로 그린다. 한 사실은 한 곳에만 둔다(왼쪽: 상태·공유 유지, 오른쪽: 30일·복구). 되돌리기 어려운 동작이라 위험 버튼은 `error` 채움 하나만 쓰고, 안전한 취소를 왼쪽에 둔다. 표시 이름 예약 안내는 점선 라벨 자리에 `[미확인]`으로 남긴다. 상태 A는 같은 화면을 `scrim`으로 덮고 대화상자 안에 완료 표지(아치 메달리온, 완료 상태 표지)와 문구 `[문구 미확정]`, 「확인」(→ WF-01)을 둔다. 모바일은 한 열: 제목 → 안내 카드 → 시간선 카드 → 버튼 두 개(전폭 44px 이상, 취소가 위). 드로어는 일반 회원(프로필·로그아웃, 관리 없음).
- **이끈 스킬 규칙:** ui-ux-pro-max(`confirmation-dialogs`·destructive는 시각적으로 분리, `primary-action` 하나, `error-recovery`로 취소 경로, `empty-nav-state`), hallmark(카드 안 카드 금지, 라벨은 본문체·소문자 격, 상태점·가운뎃점 금지, 한 화면 약 80단어), web-design-guidelines(파괴적 동작은 확인, 구체적 버튼 라벨, `aria-live` 완료 안내, 한국어 문구 우선), frontend-design(대담함은 한 곳: 시간선, 장식 라벨 금지), design-taste-frontend(양쪽 가장자리 정렬, 빈 화면 금지).

#### WF-10 로그인 차단 안내

- **주요 목표:** 왜 로그인할 수 없는지 알고(정지, 해제되면 다시 가능), 로그인 화면으로 돌아간다. 정지 사유·기간은 기획에 없어 보여 주지 않는다.
- **정보 위계:** (1) 「로그인할 수 없습니다」 (2) 정지되어 차단됐고 해제 후 다시 로그인할 수 있다는 한 줄 (3) 「로그인 화면으로」 (4) 푸터. **헤더 없음.**
- **구성:** **차단 입구.** 캔버스 전체가 `surface`이고 가운데에 수면선(전폭 `border` 한 줄, 금색은 짧은 구간 하나)이 가로지른다. 그 위에 상태 표지로 **차단 아치 메달리온**(`warning`, `error` 색)이 서고 아래로 제목, 본문, primary 버튼이 한 열로 이어진다. 헤더가 없으므로 작은 가로형 로고를 본문 위에 두어 어느 서비스인지 알린다. v4의 무헤더 차단·상태 표지(메달리온 + 수면선)와 같은 언어다. 열린 세션 유지·정지 사유·기간은 그리지 않는다. 추가 상태 프레임 없음. 모바일은 같은 구성을 한 열로 쌓고 버튼은 전폭이다.
- **이끈 스킬 규칙:** frontend-design(오류는 사과 없이 원인과 다음 행동), ui-ux-pro-max(`error-clarity`, `primary-action`, `color-not-decorative-only`), hallmark(한 화면 한 동작, 장식 라벨 금지, 아치 메달리온은 상태 표지로만), web-design-guidelines(링크가 아니라 화면 이동 버튼, 구체적 라벨), design-taste-frontend(균형, 가운데 축 한 열).

#### WF-11 관리

- **주요 목표:** 관리자가 세 관리 기능(회원 목록, 오픈소스 관리, 카테고리 관리) 중 하나로 한 번에 들어간다.
- **정보 위계:** (1) 「관리 화면」 제목 (2) 메뉴 3개(회원 목록 → WF-12, 오픈소스 관리 → WF-13, 카테고리 관리 → WF-14) (3) 관리자 헤더의 회원 메뉴(프로필·관리·로그아웃).
- **구성:** **제목 열 + 메뉴 목록.** 같은 아이콘 타일 3개를 가로로 나열하는 흔한 카드 줄을 피했다(hallmark 게이트 3). 왼쪽 4열은 제목과 금색 수면선만, 오른쪽 8열(728)은 한 장의 목록 카드이고 행 3개가 전폭 링크다. 행마다 아이콘, 이름, 짧은 설명, 오른쪽 끝의 이동 표시(chevron)와 목적지 라벨(WF-12/13/14, 시안용 주석)이 있다. WF-13·14 화면은 그리지 않는다. **상태 A는 별도 UI가 없다**(일반 회원은 안내 없이 WF-02로 이동, AC-FR-ADM-001-02·03): 프레임을 만들지 않고 문서에만 적는다. 비로그인 직접 접근은 [미확인]. 관리자 헤더 차이를 보이기 위해 회원 메뉴가 열린 프레임을 데스크톱 라이트·다크에 추가한다. 모바일 드로어는 프로필·관리·로그아웃.
- **이끈 스킬 규칙:** design-taste-frontend(3열 아이콘 카드 반복 금지, 비대칭 4/8 구성, 양쪽 가장자리), hallmark(게이트 3 카드 징후, 장식 숫자·라벨 금지, 표면 사다리), ui-ux-pro-max(`nav-hierarchy`, `touch-target-size`, 관리자 메뉴는 현재 위치 표시), web-design-guidelines(링크는 `<a>`, 메뉴 항목은 키보드 이동), frontend-design(대담함은 한 곳: 비대칭 제목 열의 수면선).

#### WF-12 관리자 회원 목록

- **주요 목표:** 회원을 확인하고, 필요하면 정지하거나 해제한다. 정지는 확인을 거친다.
- **정보 위계:** (1) 「회원 목록」 제목과 경로(관리 > 회원 목록) (2) 표(표시 이름, 이메일, 정지 여부 이용 중/정지, 동작) (3) 행 동작(정지 / 해제) (4) 정지 확인 대화상자.
- **구성:** **관리 표.** 1120 전폭 한 장의 표 카드, 헤더 행과 행 구분선은 장식 `border`. 정지 여부는 색만이 아니라 글자(이용 중 / 정지)와 아이콘 없는 배지로 구분한다(`success`/`error` 계열 배지, 본문은 `text`). 동작 열의 「정지」는 secondary(글자 `error` 아님, 경계 `border-strong`), 「해제」는 secondary다. 확인 대화상자는 대상 회원 이름·이메일을 보여 주고 취소·정지 확인(위험 버튼)을 두며, 확인하면 다음 로그인부터 차단되고 열린 세션은 로그아웃까지 유지된다는 안내만 문장으로 둔다(세션 UI 없음). 해제에는 대화상자가 없다. 행 선택 UI·검색·정렬·페이지 나눔은 [미확인]이라 그리지 않는다. 상태 A는 표 머리를 두고 본문을 메달리온 빈 상태로 바꾼다. 모바일은 표가 아니라 행 카드 목록(이름·이메일·배지 + 44px 동작 버튼)으로 접는다(DS는 표 안 가로 스크롤이지만 좁은 폭에서 읽기 쉬운 쪽을 택한 제안). 드로어는 관리자(프로필·관리·로그아웃).
- **이끈 스킬 규칙:** ui-ux-pro-max(`confirmation-dialogs`, `destructive-emphasis`, `empty-states`, `color-not-decorative-only`, `touch-target-size`), web-design-guidelines(파괴적 동작은 확인 모달, 숫자·이메일 `tabular-nums`·`translate="no"`, 긴 값은 말줄임·`min-w-0`, 아이콘 버튼 접근 이름), hallmark(표 머리는 본문체 소문자 격, 카드 안 카드 금지, 상태점 금지), design-taste-frontend(표가 열을 채움, 가장자리 정렬), frontend-design(오류·빈 상태는 원인과 행동).

### 스킬 적용 기록

| 스킬 | 로드 방법 | 읽은 파일 | 가져온 규칙·권고 | 반영한 화면·상태 |
| --- | --- | --- | --- | --- |
| frontend-design | Skill 도구 | 플러그인 `SKILL.md`(Skill 호출 결과) | 주제(나루·건너는 곳)에서 모티프, 한 곳에만 대담함, 장식 라벨·한 단어 강조 금지, 오류·빈 상태는 원인과 행동 | WF-09 시간선, WF-10 차단 메달리온·수면선, WF-11 비대칭 제목 열, 전 화면 문구 |
| design-taste-frontend | Skill 도구 + Read | `SKILL.md`, `references/layout-v4.md`(제품 앱이라 마케팅·셰이더·사진 규칙과 `gate.mjs`는 제외) | 양쪽 가장자리, 상단 정렬, 빈 화면 금지, 3열 아이콘 카드 지양 | WF-09 664/424, WF-11 4/8, WF-12 전폭 표 |
| ui-ux-pro-max | Skill 도구 + Read | `SKILL.md`, `references/pro-rules.md`(`search.py` 미실행, 팔레트 hex 미사용) | 터치 44, 파괴적 동작 확인, 오류는 원인+다음 행동, 빈 상태 행동, 색만으로 전달 금지, 다크는 독립 점검 | 전 화면 버튼·배지, WF-09 A, WF-12 B |
| hallmark | Skill 도구 + Read | `SKILL.md`, `references/gates.md`(lint 미실행) | 라벨 본문체·소문자 격, 가운뎃점·상태점·이모지 금지, 카드 안 카드 금지, 게이트 3(아이콘 카드 줄), 한 화면 약 80단어 | WF-11 목록 행, 푸터, 전 화면 카드 |
| web-design-guidelines | Skill 도구 + 프롬프트 인라인 규칙 | `SKILL.md`(네트워크 미사용) | 파괴적 동작 확인, 구체적 라벨, `…`, 포커스 가시성은 구현 단계, 고유 문자열 `translate="no"` | WF-09 A·WF-12 B 대화상자, 이메일 셀 |

구성 근거에 적은 `kebab-case` 규칙 이름(`confirmation-dialogs`, `primary-action`, `destructive-emphasis`, `empty-states` 등) 일부는 이전 절의 표기를 따른 것이다. ui-ux-pro-max의 `references/quick-reference.md`는 이번에 열지 않아 원문 대조는 [미확인]이다. 실제로 읽어 근거로 삼은 것은 `SKILL.md`의 우선순위 표와 `pro-rules.md`의 점검표다. design-taste-frontend·frontend-design·web-design-guidelines의 나머지 참조 파일, hallmark의 `craft.md` 등은 이번에 열지 않았다. `gate.mjs`·`search.py`·`sloplint.mjs`·네트워크는 쓰지 않았다.

### WF-09~12 프레임과 상태 (WF · FR/AC · 상태)

**프레임 합계 36개** = 데스크톱 16(기본·상태·메뉴 열림 8 × 라이트·다크) + 모바일 14(기본·상태 7 × 라이트·다크) + 모바일 헤더 드로어 6(WF-09·11·12 × 라이트·다크). 데스크톱 1440×900, 모바일 폭 360(높이는 내용에 맞춤, 상태 A·B 모바일과 드로어는 360×800~812 뷰포트). 라이트·다크는 같은 구조에 변수 컬렉션 `Deep Ink`의 Light/Dark 모드만 바꿨다. 파일 안 `TEMPLATE-*` 프레임과 로고 원본은 복제용 작업 부품이며 내보내지 않았다.

| WF | 상태 | 관련 FR / AC | 화면 내용 |
| --- | --- | --- | --- |
| WF-09 탈퇴 확인 | 기본 | FR-AUTH-003 · AC-FR-AUTH-003-01·02 | 일반 회원 헤더·푸터, 「탈퇴 확인」, 탈퇴 상태·공유·링크 유지 안내 카드, 30일 보관 시간선(탈퇴 확인 → 보관 기간 → 데이터 삭제, 재가입 복구), 취소(→ WF-16, secondary)·탈퇴 확인(위험 버튼), 표시 이름 예약 안내 자리 `[미확인]` |
| WF-09 | A 탈퇴 완료 안내 | AC-FR-AUTH-003-03 | `scrim` 위 대화상자: 완료 표지(아치 메달리온), 문구 `[문구 미확정]`, 「확인」(→ WF-01) |
| WF-09 | 모바일 드로어 | FR-SHELL-001 | 일반 회원: 닫기, 서비스 전환, 카테고리, 프로필, 로그아웃. 관리·테마 선택기 없음 |
| WF-10 로그인 차단 안내 | 기본 | FR-AUTH-005 · AC-FR-AUTH-005-01·03 | **헤더 없음**·푸터. 작은 로고, 차단 아치 메달리온(수면선 위에 선 형태), 「로그인할 수 없습니다」, 정지로 차단·해제 후 다시 로그인 가능, 「로그인 화면으로」(→ WF-01, 문구 `[문구 미확정]`). 정지 사유·기간·열린 세션 표시 없음. 추가 상태·드로어 없음 |
| WF-11 관리 | 기본 | FR-ADM-001~004 · AC-FR-ADM-001-01, AC-FR-SHELL-001-04 | 관리자 헤더, 「관리 화면」, 메뉴 3행(회원 목록 → WF-12, 오픈소스 관리 → WF-13, 카테고리 관리 → WF-14), 목적지 주석 |
| WF-11 | 회원 메뉴 열림(시안 추가) | AC-FR-SHELL-001-04 | 관리자 헤더의 회원 메뉴: 프로필·관리(현재 위치)·로그아웃. 관리자 변형의 항목 차이를 보이기 위한 프레임 |
| WF-11 | 상태 A(문서에만, 프레임 없음) | AC-FR-ADM-001-02·03 | 관리자가 아닌 회원은 **안내 없이 WF-02로 이동**한다. 별도 차단 UI·화면 없음. 비로그인 직접 접근은 [미확인] |
| WF-11 | 모바일 드로어 | FR-SHELL-001 | 관리자: 프로필·**관리**·로그아웃 |
| WF-12 회원 목록 | 기본 | FR-ADM-001·002 · AC-FR-ADM-001-01·04, AC-FR-ADM-002-01·02 | 관리자 헤더, 경로(관리 > 회원 목록), 표(표시 이름·이메일·정지 여부 이용 중/정지·동작 정지/해제). 이름은 예시이며 미설정 시 Google 계정 이름 행 포함(`Hana Park`). 해제는 대화상자 없음. 모바일은 행 카드 목록 |
| WF-12 | A 회원 없음 | AC-FR-ADM-001-01 | 표 머리 유지, 본문 메달리온 빈 상태, 문구 `[문구 미확정]` |
| WF-12 | B 정지 확인 대화상자 | AC-FR-ADM-002-03 · AC-FR-AUTH-005-02 | 대상 회원 이름·이메일, 다음 로그인부터 차단·열린 세션은 로그아웃까지 유지(안내 문장만), 취소·정지 확인(위험 버튼), 문구 `[문구 미확정]` |
| WF-12 | 모바일 드로어 | FR-SHELL-001 | 관리자 항목 포함 |

공통 푸터(이용약관, 개인정보처리방침, 오픈소스 라이선스 고지, 문의 `aslanhobae@gmail.com`, `Dev. Aslan0`, 회사 정보 없음)는 모든 프레임에 있다(WF-10 포함, 헤더만 없다). 테마 선택기(Q-090)는 어디에도 없다. 로딩 화면은 기획에 없어 만들지 않았다. 표의 이름·이메일은 예시(`example.com`)다.

### PNG 파일 링크 표 (`exports/wf09-12/`)

| 화면·상태 | 데스크톱 라이트 | 데스크톱 다크 | 모바일 라이트 | 모바일 다크 |
| --- | --- | --- | --- | --- |
| WF-09 기본 | [png](exports/wf09-12/WF-09-withdraw-desktop-light.png) | [png](exports/wf09-12/WF-09-withdraw-desktop-dark.png) | [png](exports/wf09-12/WF-09-withdraw-mobile-light.png) | [png](exports/wf09-12/WF-09-withdraw-mobile-dark.png) |
| WF-09 A | [png](exports/wf09-12/WF-09-withdraw-desktop-light-state-A.png) | [png](exports/wf09-12/WF-09-withdraw-desktop-dark-state-A.png) | [png](exports/wf09-12/WF-09-withdraw-mobile-light-state-A.png) | [png](exports/wf09-12/WF-09-withdraw-mobile-dark-state-A.png) |
| WF-10 기본 | [png](exports/wf09-12/WF-10-login-blocked-desktop-light.png) | [png](exports/wf09-12/WF-10-login-blocked-desktop-dark.png) | [png](exports/wf09-12/WF-10-login-blocked-mobile-light.png) | [png](exports/wf09-12/WF-10-login-blocked-mobile-dark.png) |
| WF-11 기본 | [png](exports/wf09-12/WF-11-admin-desktop-light.png) | [png](exports/wf09-12/WF-11-admin-desktop-dark.png) | [png](exports/wf09-12/WF-11-admin-mobile-light.png) | [png](exports/wf09-12/WF-11-admin-mobile-dark.png) |
| WF-11 회원 메뉴 열림 | [png](exports/wf09-12/WF-11-admin-desktop-light-menu-open.png) | [png](exports/wf09-12/WF-11-admin-desktop-dark-menu-open.png) | (모바일은 드로어) | (모바일은 드로어) |
| WF-12 기본 | [png](exports/wf09-12/WF-12-members-desktop-light.png) | [png](exports/wf09-12/WF-12-members-desktop-dark.png) | [png](exports/wf09-12/WF-12-members-mobile-light.png) | [png](exports/wf09-12/WF-12-members-mobile-dark.png) |
| WF-12 A | [png](exports/wf09-12/WF-12-members-desktop-light-state-A.png) | [png](exports/wf09-12/WF-12-members-desktop-dark-state-A.png) | [png](exports/wf09-12/WF-12-members-mobile-light-state-A.png) | [png](exports/wf09-12/WF-12-members-mobile-dark-state-A.png) |
| WF-12 B | [png](exports/wf09-12/WF-12-members-desktop-light-state-B.png) | [png](exports/wf09-12/WF-12-members-desktop-dark-state-B.png) | [png](exports/wf09-12/WF-12-members-mobile-light-state-B.png) | [png](exports/wf09-12/WF-12-members-mobile-dark-state-B.png) |

모바일 드로어(360×800)

| 화면 | 라이트 | 다크 |
| --- | --- | --- |
| WF-09 드로어(일반 회원) | [png](exports/wf09-12/WF-09-withdraw-mobile-light-drawer.png) | [png](exports/wf09-12/WF-09-withdraw-mobile-dark-drawer.png) |
| WF-11 드로어(관리자) | [png](exports/wf09-12/WF-11-admin-mobile-light-drawer.png) | [png](exports/wf09-12/WF-11-admin-mobile-dark-drawer.png) |
| WF-12 드로어(관리자) | [png](exports/wf09-12/WF-12-members-mobile-light-drawer.png) | [png](exports/wf09-12/WF-12-members-mobile-dark-drawer.png) |

`exports/wf09-12/.keep`은 export 폴더 생성을 위한 플레이스홀더다.

### 새 토큰·컴포넌트 제안

새 DS 색 토큰은 없다. 쓴 변수는 `bg`, `surface`, `surface-raised`, `surface-hover`, `text`, `text-muted`, `border`, `border-strong`, `primary`, `on-primary`, `accent`, `error`, `error-subtle`, `success`, `success-subtle`, `on-danger`, `overlay`, `scrim`(DS 값 그대로)이다. 파일 안에 **`wordmark` 보조 변수** 하나를 더 만들었다(라이트 `#1E3A5F`, 다크 `#E8EDF5`): DS 로고 SVG의 워드마크 색이 라이트는 `primary`, 다크는 `text` 계열이라 한 변수로 모드 전환하려고 둔 파일 내부 값이며 DS 토큰 제안은 아니다(로고 자산 다크 변형을 컴포넌트화하면 필요 없음). 아래는 DS에 반영하지 않은 제안이다.

- **Danger 버튼(확인 대화상자용)**: DS에 `error`/`on-danger`/`danger-hover`/`danger-pressed`가 있으나 이 파일은 hover·pressed를 그리지 않았다. WF-09·WF-12 대화상자의 「탈퇴 확인」·「정지 확인」에 DS의 Danger 버튼을 연결해야 한다.
- **보관 시간선(Retention timeline)**: WF-09 전용 세로 시간선(점 2개 + 보관 구간 막대). 재사용 계획이 있으면 컴포넌트화 검토.
- **관리 메뉴 행(Admin menu row)**: WF-11의 아이콘·제목·설명·이동 표시 행. DS의 Service card·Menu와 조정 필요.
- **회원 메뉴 관리자 변형의 「현재 위치」 표시**: 시안은 `surface-hover` 바탕 + 굵은 글자로 표시. DS Menu의 `회원 관리자` 변형과 맞춰야 한다.
- **Arch medallion**(v4·WF-05~08 제안의 연장): 80×96, 빈 상태·차단·완료 표지에 같은 규격으로 썼다. WF-10 차단 표지는 수면선(`border-strong` 전폭 선) 위에 서도록 배치했다.
- **Admin table 모바일 변형**: DS는 표 안 가로 스크롤인데 이 파일은 행 카드 목록으로 접었다(제안).
- **Badge 이용 중/정지**: `success-subtle`+`success`, `error-subtle`+`error` 글자 배지(상태점 없음). DS Badge와 일치하는지 확인 필요.
- **목적지 주석(점선 칩, WF-12/13/14)**: 시안용 주석이며 실제 UI가 아니다. 구현 시 제거.

### 열린 기획 질문 (모두 기획 확인 필요)

- **WF-09**: 탈퇴 후 표시 이름 예약(30일) 안내를 화면에 둘지(BR-026, 시안은 점선 라벨 자리), 처리 실패·재탈퇴 시 화면 표현, 완료 안내 문구와 「확인」 버튼 문구, 완료 안내 뒤 WF-01로 가는 방식(자동/버튼), 시간선 문구(「오늘」「30일이 지나면 삭제됩니다」)의 확정 여부.
- **WF-10**: 버튼 문구와 안내 문구 확정, 정지 사유·기간은 표시하지 않는 것으로 두었다(기획에 없음), 직접 접근·로딩·오류 표현. 「토큰 갱신 시에도 차단」(pending planning)의 UI 표현은 그리지 않았다.
- **WF-11**: 비로그인 직접 접근의 이동 위치, 메뉴 설명 문구(시안은 FR 이름에서 옮긴 초안), 로딩·오류, 관리 화면 안에서 WF-13·14로의 이동 표현.
- **WF-12**: 정지 확인 문구, 빈 목록 문구, 행 선택·검색·정렬·페이지 나눔 필요 여부(회원 수가 많을 때), 로딩·오류, 정지/해제 직후의 피드백(Toast 필요 여부, 해제는 확인 대화상자 없음), 정지된 회원의 행 표시 추가 정보(사유·시각은 기획에 없음).
- **공통**: Q-090 테마 선택기 위치(어느 프레임에도 두지 않음), 모바일 헤더·푸터·드로어 배치의 기획 확정 여부, 관리자 헤더에 관리 바로가기를 따로 둘지(시안은 회원 메뉴 안에만).

### WF-09~12 한계와 [미확인]

- 글꼴: 헤드리스 FigCraft에 IBM Plex Sans KR이 없어 한글은 대체 글꼴로 렌더링될 수 있다. 파일에는 IBM Plex Sans KR / IBM Plex Sans 지정이 남아 있다.
- 대비는 DS 대비표의 토큰 쌍만 골랐고 화면별로 다시 측정하지 않았다(DEC-102 화면 단위 충족 [미확인]). 12·13px 보조 문구는 `text-muted`로 DS 표의 4.5:1 이상 쌍이다. 키보드 포커스·읽기 순서·터치 동작은 시안으로 검증할 수 없다 [미확인]. 호버·눌림·포커스 상태는 그리지 않았다.
- 카드·대화상자·드롭다운 그림자 색은 변수에 묶지 않은 고정 값이다(다크에서도 같은 값).
- WF-11 「회원 메뉴 열림」 프레임에서 열린 메뉴가 첫 메뉴 행의 목적지 주석을 가린다(팝오버의 실제 동작).
- WF-11은 본문 아래 여백이 비교적 넓다(메뉴가 3개뿐이고 기획에 없는 기능을 채우지 않는 선택).
- 줄바꿈은 글자 수 기준으로 직접 넣은 모바일 문구가 있다(WF-09 모바일, WF-10 모바일, WF-11 모바일 설명). 실제 글꼴·폭에서는 다시 확인해야 한다 [미확인].
- 눈으로 확인한 프레임: WF-09 데스크톱 라이트·상태 A 라이트·모바일 라이트·다크 상태 A·데스크톱 다크, WF-10 데스크톱·모바일 라이트, WF-11 데스크톱·모바일 라이트·메뉴 열림 다크·관리자 드로어 라이트/다크, WF-12 데스크톱 라이트·A·B, 모바일 라이트·A·B, 모바일 다크 B. 나머지는 같은 구조의 복제본이라 개별 확인을 하지 않았다 [미확인]. PNG 파일 자체를 다시 열어 보지는 않았다(내보내기 응답의 바이트 수만 확인).
- 사용한 도구는 FigCraft MCP, Skill, Read, Edit, Write(`.keep`)이다. 웹·셸·REPL은 쓰지 않았다.
