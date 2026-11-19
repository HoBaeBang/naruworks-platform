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
