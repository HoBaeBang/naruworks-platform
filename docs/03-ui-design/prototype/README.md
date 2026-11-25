# 클릭 프로토타입 연결 목록

작업 파일: `prototype-wf01-02.figcraft` (데스크톱·라이트 기본 상태만)

호배님 결정(2026-11-25 23:20 KST): FigCraft 프로토타입 연결(`proto.interaction.add`)은 중단한다. 이미 만든 연결과 작업 파일은 그대로 두고, 남은 이동은 아래 표에만 적는다.

## 흐름 시작점

| 이름 | 시작 프레임 | id |
|---|---|---|
| UF-01 로그인 | `WF-01-login-desktop-light` | 72 |
| UF-02 Litpage 최초 진입 | `WF-02-home-desktop-light` | 208 |

## 화면 이동 표

상태: `연결됨` = FigCraft에 연결됨(클릭 → 이동, 전환 instant). `표만` = 기획으로 이동이 확정됐으나 연결하지 않음. `미확인` = 기획에 도착이나 진입점이 [미확인].

| 시작 프레임 | 트리거 | 도착 프레임 | 근거 요구사항 | 상태 |
|---|---|---|---|---|
| `WF-01-login-desktop-light` (72) | `button-google-login (primary lg)` (Google로 로그인) (82) | `WF-02-home-desktop-light` (208) | FR-AUTH-001, AC-FR-AUTH-001-01, UF-01 | 연결됨 |
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
| WF-01 | Google로 로그인 버튼(정지 계정 시도, 같은 버튼 82와 별도 행) | WF-10 | FR-AUTH-005, BR-005, AC-FR-AUTH-005-01, UF-01 | 표만 |
| 외부 공유 링크(비회원) | 링크 열기 | WF-08 | FR-DRV-007, BR-008, AC-FR-DRV-007-01, AC-NFR-SEC-003-01, UF-04 | 표만 |
| WF-08 | 비회원 헤더 로그인 버튼 | WF-01 | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-05, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04 | 표만 |
| WF-08 | 비회원 헤더 로고 | WF-01 | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-06, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04 | 표만 |
| WF-08 | 비회원 헤더 카테고리 | WF-01 | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-06, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04 | 표만 |
| WF-08 | 비회원 헤더 서비스 전환 | WF-01 | FR-SHELL-001, FR-DRV-007, AC-FR-SHELL-001-06, AC-FR-DRV-007-03, AC-FR-DRV-007-04, UF-04 | 표만 |
| WF-10 | 로그인 화면으로 버튼 | WF-01 | FR-AUTH-005, BR-005, AC-FR-AUTH-005-03, UF-01 | 표만 |
| 관리자 헤더가 있는 화면 | 회원 메뉴 → 관리(관리자만) | WF-11 | FR-SHELL-001, FR-ADM-001, AC-FR-SHELL-001-04, UF-06 | 표만 |
| WF-11 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| WF-11 | 회원 목록 | WF-12 | FR-ADM-001, FR-ADM-002, AC-FR-ADM-001-01, UF-06 | 표만 |
| WF-11 | 오픈소스 관리 | WF-13 | FR-ADM-003, AC-FR-ADM-003-01, UF-06 | 표만 |
| WF-11 | 카테고리 관리 | WF-14 | FR-ADM-004, AC-FR-ADM-004-01, UF-06 | 표만 |
| WF-11 | 일반 회원 URL 직접 진입(안내 없음) | WF-02 | FR-ADM-001, BR-017, AC-FR-ADM-001-02, AC-FR-ADM-001-03, UF-06 | 표만 |
| WF-12 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| WF-12 | 일반 회원 접근 | WF-02 | 미확인 | 표만 |
| WF-13 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| WF-14 | 로고 | WF-02 | FR-SHELL-001, FR-HOME-001, AC-FR-SHELL-001-01, UF-02 | 표만 |
| WF-07 | 닫기 | 미확인 (WF-05 여부 [미확인]) | FR-DRV-006, AC-FR-DRV-006-04, UF-03 | 미확인 |

주석

- 연결됨 22행, 표만 17행, 미확인 1행.
- 탈퇴 확인(4415)은 72에 직접 잇지 않고 상태 A(4430)를 거친다. 4483→72는 82를 건드리지 않는다.
- 208의 기본 프레임은 메뉴가 닫혀 「프로필」 항목이 없어, 항목 대신 회원 메뉴 트리거 버튼(224)에 연결했다.
- WF-10·WF-11·WF-08 진입은 별도 시작점이 필요해 표의 진입 행으로만 적었다. WF-12·13·14의 진입은 WF-11 행으로 갈음한다.
- WF-10에는 헤더가 없어 로고 행을 두지 않았다. 같은 화면에 머무는 갱신·선택·정지·해제·숨김·노출 등은 표에 넣지 않았다.
- 공통 헤더의 프로필 열기(WF-15)·로그아웃(WF-01)·서비스 전환·카테고리 이동은 WF-11~14에 대해 표에 따로 적지 않았다(WF-08 비회원 헤더만 화면 고유 동작이라 적음).
- 막혀 있던 WF-13·14의 진입은 이제 위 표의 WF-11 행으로 대체한다. FigCraft 연결은 하지 않는다.
