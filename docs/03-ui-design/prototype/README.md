# 클릭 프로토타입 연결 목록

호배님 결정(2026-11-25 23:20 KST): FigCraft 프로토타입 연결(`proto.interaction.add`)은 기본적으로 중단한다. 이미 만든 연결과 작업 파일은 그대로 두고, 남은 이동은 아래 표에만 적는다.

v1.1 순서 6(2026-11-27, P3-6-v11-proto-01): 화면 파일에 이미 있던 공유받은 파일 데스크톱 라이트 연결을 표에 반영하고, 같은 사이드바에서 빠져 있던 휴지통 연결 4개만 `screens-wf05-08.figcraft`에서 보완했다. 교차 파일 도착(WF-01·WF-02 등)과 그 밖의 이동은 표만. 다크·모바일에는 새 연결을 달지 않았다. `prototype-wf01-02.figcraft`의 기존 22개 연결은 그대로다.

## 파일과 ID

| 파일 | 역할 |
|---|---|
| `prototype/prototype-wf01-02.figcraft` | P3-5 작업 파일. 기존 연결 22개. 2026-11-25 시안 복사본이라 WF-05 이후 ID가 화면 파일과 다르다. 이 파일은 순서 6에서 열거나 고치지 않았다. |
| `screens/screens-wf05-08.figcraft` | 라이브 시안(WF-05~08). v1.1 공유받은 파일 연결과 이번 휴지통 보완. |
| `screens/screens-wf01-04-v4.figcraft` 등 | 라이브 시안. WF-01~04 기본 프레임 ID는 프로토타입 파일과 같다(72·208·919·1201). 언어 전환 등 v1.1 시안 변경은 화면 파일에만 있다. |

프로토타입 파일 → 화면 파일 ID(참고): `WF-05-drive-desktop-light` 3769→209, `WF-06-trash-desktop-light` 3996→3968, `WF-07-member-share-desktop-light` 4163→5539, `WF-09-withdraw-desktop-light` 4384→50(`screens-wf09-12.figcraft`), `WF-15-profile-desktop-light` 4300→326·`WF-16-account-desktop-light` 4354→547(`screens-wf13-16.figcraft`).

## 흐름 시작점

작업 파일: `prototype-wf01-02.figcraft` (데스크톱·라이트 기본 상태)

| 이름 | 시작 프레임 | id |
|---|---|---|
| UF-01 로그인 | `WF-01-login-desktop-light` | 72 |
| UF-02 Litpage 최초 진입 | `WF-02-home-desktop-light` | 208 |

## 화면 이동 표

상태: `연결됨` = FigCraft에 연결됨(클릭 → 이동, 전환 instant). `표만` = 기획으로 이동이 확정됐으나 연결하지 않음(교차 파일이거나 연결 중단 결정). `미확인` = 도착·진입점이 기획상 `[미확인]`이거나, 시안에 트리거가 없어 연결할 수 없음.

### A. `prototype-wf01-02.figcraft` (기존 연결, 유지)

| 시작 프레임 | 트리거 | 도착 프레임 | 근거 요구사항 | 상태 |
|---|---|---|---|---|
| `WF-01-login-desktop-light` (72) | `button-google-login (primary lg)` (Google로 로그인) (82) | `WF-02-home-desktop-light` (208) | FR-AUTH-001, AC-FR-AUTH-001-01, UF-01, DEC-110 | 연결됨 |
| `WF-02-home-desktop-light` (208) | `service-card-litpage` (Litpage 카드 전체, 첫 진입) (236) | `WF-03-folder-desktop-light` (919) | AC-FR-OSS-002-01 | 연결됨 |
| `WF-03-folder-desktop-light` (919) | `button-cancel (secondary md)` (취소) (980) | `WF-02-home-desktop-light` (208) | AC-FR-OSS-002-02 | 연결됨 |
| `WF-03-folder-desktop-light` (919) | `button-confirm (primary md)` (확인) (982) | `WF-04-litpage-desktop-light` (1201) | AC-FR-OSS-002-01 | 연결됨 |
| `WF-04-litpage-desktop-light` (1201) | `logo` (헤더 로고) (1204) | `WF-02-home-desktop-light` (208) | AC-FR-SHELL-001-01 | 연결됨 |
| `WF-02-home-desktop-light` (208) | `service-card-drive` (나루 드라이브 카드 전체) (256) | `WF-05-drive-desktop-light` (3769) | AC-FR-DRV-001-01 | 연결됨 |
| `WF-05-drive-desktop-light` (3769) | `logo` (헤더 로고) (3772) | `WF-02-home-desktop-light` (208) | AC-FR-SHELL-001-01, UF-02 | 연결됨 |
| `WF-05-drive-desktop-light` (3769) | `menu-trash` (왼쪽 메뉴 휴지통) (3803) | `WF-06-trash-desktop-light` (3996) | AC-FR-DRV-004-04, UF-03 | 연결됨 |
| `WF-06-trash-desktop-light` (3996) | `logo` (헤더 로고) (3999) | `WF-02-home-desktop-light` (208) | AC-FR-SHELL-001-01, UF-02 | 연결됨 |
| `WF-06-trash-desktop-light` (3996) | `menu-my-drive` (왼쪽 메뉴 내 드라이브) (4026) | `WF-05-drive-desktop-light` (3769) | FR-DRV-001, UF-03 | 연결됨 |
| `WF-05-drive-desktop-light` (3769) | `btn-member-share` (선택 동작 띠 회원 공유) (3839) | `WF-07-member-share-desktop-light` (4163, y=23000에 붙임) | AC-FR-DRV-006-01, UF-03 | 연결됨 |
| `WF-07-member-share-desktop-light` (4163) | `logo` (헤더 로고) (4166) | `WF-02-home-desktop-light` (208) | AC-FR-SHELL-001-01, UF-02 | 연결됨 |
| `WF-02-home-desktop-light` (208) | `member-menu-button (접근 이름: 회원 메뉴)` (헤더 회원 메뉴 트리거, 프로필 열기) (224) | `WF-15-profile-desktop-light` (4300, y=25000에 붙임) | AC-FR-SHELL-001-01, UF-07 | 연결됨 |
| `WF-15-profile-desktop-light` (4300) | `logo` (헤더 로고) (4302) | `WF-02-home-desktop-light` (208) | AC-FR-SHELL-001-01, UF-02 | 연결됨 |
| `WF-15-profile-desktop-light` (4300) | `account-settings-link` (계정 설정 이동 행) (4332) | `WF-16-account-desktop-light` (4354, y=27000에 붙임) | AC-FR-AUTH-006-01, UF-05 | 연결됨 |
| `WF-16-account-desktop-light` (4354) | `logo` (헤더 로고) (4356) | `WF-02-home-desktop-light` (208) | AC-FR-SHELL-001-01, UF-02 | 연결됨 |
| `WF-16-account-desktop-light` (4354) | `menu-card` (탈퇴 메뉴 한 줄 프레임) (4379) | `WF-09-withdraw-desktop-light` (4384, y=29000에 붙임) | AC-FR-AUTH-006-01, AC-FR-AUTH-003-01, UF-05 | 연결됨 |
| `WF-09-withdraw-desktop-light` (4384) | `logo` (헤더 로고) (4386) | `WF-02-home-desktop-light` (208) | AC-FR-SHELL-001-01, UF-02 | 연결됨 |
| `WF-09-withdraw-desktop-light` (4384) | `button-cancel (→ WF-16)` (취소 secondary) (4413) | `WF-16-account-desktop-light` (4354) | AC-FR-AUTH-003-02, UF-05 | 연결됨 |
| `WF-16-account-desktop-light` (4354) | `crumb-profile-link (→ WF-15)` (경로 「프로필」 링크 프레임) (4429) | `WF-15-profile-desktop-light` (4300) | UF-05 | 연결됨 |
| `WF-09-withdraw-desktop-light` (4384) | `button-withdraw-confirm (danger → 상태 A)` (탈퇴 확인 위험 버튼) (4415) | `WF-09-withdraw-desktop-light-state-A` (4430, y=31000에 붙임) | AC-FR-AUTH-003-01, AC-FR-AUTH-003-03, UF-05 | 연결됨 |
| `WF-09-withdraw-desktop-light-state-A` (4430) | `button-ok (primary → WF-01)` (완료 안내 확인) (4483) | `WF-01-login-desktop-light` (72) | UF-05 | 연결됨 |

### B. `screens-wf05-08.figcraft` (v1.1 공유받은 파일, 데스크톱 라이트만)

| 시작 프레임 | 트리거 | 도착 프레임 | 근거 요구사항 | 상태 |
|---|---|---|---|---|
| `WF-05-drive-desktop-light` (209) | `menu-shared-files` (8465) | `WF-05-drive-desktop-light-shared` (8473) | 호배님 결정 2026-11-26 21:07, FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-state-A`~`E` (547·716·885·1054·1223) | `menu-shared-files` (9193·9197·9201·9205·9209) | 8473 | 같은 결정, FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-shared` (8473) | `menu-my-drive` (8503) | 209 | FR-DRV-001 | 연결됨 |
| `WF-05-drive-desktop-light-shared` (8473) | `row-litpage-doc` (행 1, 편집 권한) (8601) | `WF-05-drive-desktop-light-shared-edit` (8845) | 호배님 결정 2026-11-26 21:07, FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-shared` (8473) | `row-litpage-doc` (행 2, 보기) (8650) | `WF-05-drive-desktop-light-shared-view` (8928) | FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-shared` (8473) | `row-litpage-doc` (행 3, 화면용만) (8659) | `WF-05-drive-desktop-light-shared-view-screen` (9233) | FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-shared` (8473) | `menu-trash` (8511) | `WF-06-trash-desktop-light` (3968) | AC-FR-DRV-004-04, UF-03 | 연결됨 (P3-6-v11-proto-01에서 추가) |
| `WF-05-drive-desktop-light-shared-edit` (8845) | `menu-my-drive` (8875) | 209 | FR-DRV-001 | 연결됨 |
| `WF-05-drive-desktop-light-shared-edit` (8845) | `menu-shared-files (current)` (8879) | 8473 | FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-shared-edit` (8845) | `menu-trash` (8883) | 3968 | AC-FR-DRV-004-04, UF-03 | 연결됨 (P3-6-v11-proto-01에서 추가) |
| `WF-05-drive-desktop-light-shared-view` (8928) | `menu-my-drive` (8958) | 209 | FR-DRV-001 | 연결됨 |
| `WF-05-drive-desktop-light-shared-view` (8928) | `menu-shared-files (current)` (8962) | 8473 | FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-shared-view` (8928) | `menu-trash` (8966) | 3968 | AC-FR-DRV-004-04, UF-03 | 연결됨 (P3-6-v11-proto-01에서 추가) |
| `WF-05-drive-desktop-light-shared-view-screen` (9233) | `menu-my-drive` (9263) | 209 | FR-DRV-001 | 연결됨 |
| `WF-05-drive-desktop-light-shared-view-screen` (9233) | `menu-shared-files (current)` (9267) | 8473 | FR-DRV-006 | 연결됨 |
| `WF-05-drive-desktop-light-shared-view-screen` (9233) | `menu-trash` (9271) | 3968 | AC-FR-DRV-004-04, UF-03 | 연결됨 (P3-6-v11-proto-01에서 추가) |

### C. 표만·미확인 (교차 파일·나머지 화면)

| 시작 프레임 | 트리거 | 도착 프레임 | 근거 요구사항 | 상태 |
|---|---|---|---|---|
| WF-01 | Google로 로그인 버튼(정지 계정 시도, 같은 버튼 82와 별도 행) | WF-10 | FR-AUTH-005, BR-005, AC-FR-AUTH-005-01, UF-01 | 표만 |
| 이미 로그인한 사용자 | 로그인 화면 주소로 진입 | WF-02 (`WF-02-home-desktop-light` 208) | DEC-119, FR-AUTH | 표만 |
| 외부 공유 링크(비회원) | 링크 열기 | WF-08 (`WF-08-link-desktop-light` 6929 또는 링크의 상태) | FR-DRV-007, BR-008, AC-FR-DRV-007-01, AC-NFR-SEC-003-01, UF-04 | 표만 |
| WF-08 (6929·6980·7031) | 비회원 헤더 `login-button` (6949·7000·7051) | WF-01 (72) | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-05, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04, DEC-118 | 표만 |
| WF-01 (72) | Google로 로그인 성공 (WF-08·로그인 필요 주소에서 온 경우, 같은 버튼 82) | 원래 공유 링크 화면(WF-08, 들어오기 전 상태) | DEC-118 | 표만 |
| WF-08 | 비회원 헤더 로고 (기본 6932) | WF-01 | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-06, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04 | 표만 |
| WF-08 | 비회원 헤더 카테고리 | WF-01 | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-06, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04 | 표만 |
| WF-08 | 비회원 헤더 서비스 전환 | WF-01 | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-06, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04 | 표만 |
| WF-10 | 로그인 화면으로 버튼 | WF-01 | FR-AUTH-005, BR-005, AC-FR-AUTH-005-03, UF-01 | 표만 |
| 관리자 헤더가 있는 화면 | 회원 메뉴 → 관리(관리자만) | WF-11 (`WF-11-admin-desktop-light` 460, `screens-wf09-12.figcraft`) | FR-SHELL-001, FR-ADM-001, AC-FR-SHELL-001-04, UF-06 | 표만 |
| WF-11 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| WF-11 | 회원 목록 | WF-12 (`WF-12-members-desktop-light` 630) | FR-ADM-001, FR-ADM-002, AC-FR-ADM-001-01, UF-06 | 표만 |
| WF-11 | 오픈소스 관리 | WF-13 (`WF-13-oss-desktop-light` 66, `screens-wf13-16.figcraft`) | FR-ADM-003, AC-FR-ADM-003-01, UF-06 | 표만 |
| WF-11 | 카테고리 관리 | WF-14 (`WF-14-categories-desktop-light` 202) | FR-ADM-004, AC-FR-ADM-004-01, UF-06 | 표만 |
| WF-11 | 일반 회원 URL 직접 진입(안내 없음) | WF-02 | FR-ADM-001, BR-017, AC-FR-ADM-001-02, AC-FR-ADM-001-03, UF-06 | 표만 |
| WF-12 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| WF-12 | 일반 회원 접근 | WF-02 | 미확인 | 표만 |
| WF-13 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| WF-14 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| 공유받은 파일 데스크톱 라이트 (8473·8845·8928·9233) | `logo` (8476·8848·8931·9236) | WF-02 (208) | AC-FR-SHELL-001-01, UF-02 | 표만 (교차 파일) |
| WF-07 (`WF-07-member-share-desktop-light` 5539, 프로토타입 파일 4163) | `close-button (닫기, 도착 화면 [미확인])` (5539의 5575) | 미확인 (WF-05 여부 [미확인]) | FR-DRV-006, AC-FR-DRV-006-04, UF-03 | 미확인 |
| WF-06 휴지통 데스크톱 라이트 (3968·4217·4334) | 「공유받은 파일」 메뉴 | 8473 | FR-DRV-006 | 미확인 (시안 사이드바에 메뉴 항목이 없어 연결 불가) |

주석

- 연결됨: 프로토타입 파일 22행, 화면 파일 데스크톱 라이트 20개(표 B는 상태 A~E를 1행으로 묶음). 표만 20행, 미확인 2행.
- DEC-110: 로그인 전 고른 언어와 계정 언어가 다르면, 82→208 로그인 뒤에는 계정 언어를 따른다. 언어별 프레임 필요 여부와 로그인 전 임시 저장 방식은 `[미확인]`.
- DEC-118: WF-08 → WF-01 → 원래 WF-08 복귀는 교차 파일이라 표만. 화면 파일의 로그인 버튼에는 연결이 없다.
- DEC-119: 이미 로그인한 사용자가 로그인 화면 주소로 들어오면 WF-02로 보낸다. 표만.
- 탈퇴 확인(4415)은 72에 직접 잇지 않고 상태 A(4430)를 거친다. 4483→72는 82를 건드리지 않는다. WF-09 보관 문구(30일 보관, 받은 공유는 복원하지 않음)는 같은 화면의 문구 변경이며 이동 경로는 그대로다. 화면 파일(`50`·`95`)에는 이 연결이 없다.
- WF-14 상태 B(데스크톱 라이트 2978, 다크 3055, 모바일 라이트 3132·다크 3205)는 같은 화면의 삭제 차단 대화상자라 표에 넣지 않았다. 확인 버튼의 도착(닫힘만인지)은 `[미확인]`.
- WF-12 페이지 나눔은 같은 화면이라 표에 넣지 않았다.
- 208의 기본 프레임은 메뉴가 닫혀 「프로필」 항목이 없어, 항목 대신 회원 메뉴 트리거 버튼(224)에 연결했다.
- WF-10·WF-11·WF-08 진입은 별도 시작점이 필요해 표의 진입 행으로만 적었다. WF-12·13·14의 진입은 WF-11 행으로 갈음한다.
- WF-10에는 헤더가 없어 로고 행을 두지 않았다. 같은 화면에 머무는 갱신·선택·정지·해제·숨김·노출·페이지 나눔 등과, 목록의 current 메뉴가 자기 자신으로 가는 연결(예: 8473의 8507→8473)은 표에 넣지 않았다.
- 공통 헤더의 프로필 열기(WF-15)·로그아웃(WF-01)·서비스 전환·카테고리 이동은 WF-11~14에 대해 표에 따로 적지 않았다(WF-08 비회원 헤더만 화면 고유 동작이라 적음).
- 막혀 있던 WF-13·14의 진입은 이제 위 표의 WF-11 행으로 대체한다. FigCraft 연결은 하지 않는다.
- 표 A의 3769 로고·휴지통·회원 공유 연결은 프로토타입 파일 기준이다. 라이브 209의 `logo`(212)·`menu-trash`(250)·`btn-member-share`(286)에는 연결이 없다.
- 화면 파일 다크에도 공유받은 파일 연결 9개가 이미 있으나, 표에는 데스크톱 라이트만 적는다. 이번 잡에서 다크·모바일 연결은 추가하지 않았다. 모바일 공유받은 파일 프레임(9351·9647·9708·9897 등)에는 연결이 없다.
