<!-- naru-orch job=P1-1-readme-analysis-01 provider=antigravity model=gemini-4-hydrogen-medium agent=74ee297d-bd5a-4094-89a2-e8a421491f47 saved=2026-11-18T15:34:48+09:00 -->

# README 분석 (P1-1)

## 1. 서비스 요약 (3~5줄)
NaruWorks는 Git이나 Docker를 모르는 일반 사용자도 오픈소스 소프트웨어를 별도 설치나 추가 가입 없이 골라 쓸 수 있게 하는 오픈소스 서비스 플랫폼(오픈소스판 Steam 지향)이다.
플랫폼은 회원·소셜 로그인(인증 연동), 오픈소스 카탈로그·신청, 그리고 모든 서비스의 결과물을 한곳에 모으는 **나루 드라이브**를 핵심으로 제공한다.
직접 제공하는 서비스로 **나루 드라이브**, **문서관리**, **Naru Calendar**를 두며, 외부 오픈소스 서비스(첫 사례: Litpage)를 NaruWorks 로그인·화면 규칙·드라이브 저장에 맞춰 연동한다.
모든 회원은 기본 5GB 드라이브를 무료로 사용하며, 초과 용량은 드라이브 요금제로 제공하는 비즈니스 모델을 가진다.
결과물이 드라이브에 파일 형식으로 쌓이므로, 더 나은 오픈소스가 나와도 같은 형식을 지원하면 기존 파일로 이어서 작업할 수 있다.

---

## 2. 대상 사용자와 핵심 가치
- **대상 사용자**
  - **일반 사용자 (지인 및 비개발자)**: GitHub·Git·Docker를 몰라도 취향에 맞는 오픈소스 웹/앱 서비스를 바로 골라 쓰고, 필요 시 바꿔 쓰고 싶은 사용자 ([README.md#L22-L24](../../../README.md#L22-L24), [auth-membership-google-approval.md#L5-L6](../../../docs/architecture/auth-membership-google-approval.md#L5-L6)).
  - **플랫폼 운영자/관리자**: 회원 가입 승인·정지, 오픈소스 라이선스·보안 심사 및 온보딩, 홈서버 운영·카탈로그 관리를 담당 ([open-source-integration.md#L37-L42](../../../docs/architecture/open-source-integration.md#L37-L42), [auth-membership-google-approval.md#L12-L30](../../../docs/architecture/auth-membership-google-approval.md#L12-L30)).
- **핵심 가치**
  - **무설치·무가입 접근성**: 한 번의 NaruWorks 소셜 로그인으로 별도 가입·설치 없이 다양한 오픈소스 서비스를 즉시 사용 ([README.md#L24-L41](../../../README.md#L24-L41)).
  - **데이터 주권 및 서비스 교체 자유도(Lock-in 해소)**: 모든 산출물이 나루 드라이브에 저장되어, 다른 소프트웨어로 갈아타도 동일 파일 형식으로 작업을 이어갈 수 있음 ([README.md#L42-L43](../../../README.md#L42-L43), [README.md#L64](../../../README.md#L64)).
  - **일관된 사용자 경험**: 상단 NaruWorks 바(로고·서비스 이동·회원 메뉴) 및 하단 서비스 가이드라인을 통한 통합 UX 제공 ([README.md#L57](../../../README.md#L57), [open-source-integration.md#L31](../../../docs/architecture/open-source-integration.md#L31)).

---

## 3. 서비스 구성

| 서비스 | 설명 | 근거 위치 |
| --- | --- | --- |
| **회원과 인증** | 다양한 소셜 로그인과 회원 정보 관리, NaruWorks 계정으로 오픈소스 서비스 연결(현재 Keycloak 기반 Google 로그인 운영 중, 세션·로그아웃 통합 논의 중) | [README.md#L32](../../../README.md#L32), [README.md#L72-L77](../../../README.md#L72-L77) |
| **나루 드라이브** | 플랫폼 공용 저장소. 오픈소스·직접 서비스의 모든 결과물을 저장하며 기본 5GB 무료·초과 시 요금제 제공(폴더 조회·생성·이름 변경·이동 구현) | [README.md#L30-L33](../../../README.md#L30-L33), [README.md#L62-L63](../../../README.md#L62-L63), [README.md#L74](../../../README.md#L74) |
| **Naru Calendar** | 직접 제공하는 일정 관리 서비스(구현되어 계속 개선 중; Google Calendar 읽기 전용 연동 등) | [README.md#L30](../../../README.md#L30), [README.md#L73](../../../README.md#L73), [naru-calendar/README.md#L3](../../../docs/services/naru-calendar/README.md#L3) |
| **문서관리 (Litpage)** | 직접 제공 서비스 목록에 포함되면서 동시에 첫 연동 오픈소스(Litpage)로 연결 중인 노션형 문서 서비스(로그인 연동 반영, 배포 전) | [README.md#L30](../../../README.md#L30), [README.md#L75](../../../README.md#L75), [open-source-integration.md#L111](../../../docs/architecture/open-source-integration.md#L111) |
| **오픈소스 카탈로그·신청** | 연동된 오픈소스 목록 제공, 사용자 선택 사용, 미등록 오픈소스 사용 신청(현재 설계 단계) | [README.md#L31](../../../README.md#L31), [README.md#L40](../../../README.md#L40), [README.md#L76](../../../README.md#L76) |
| *(초기 기획)* **StablePay 연동** | 초기 기획(홈서버 포트폴리오 기준)에 있던 결제·원장·정산 모듈. 현 방향([ADR 0002](../../../docs/decisions/0002-open-source-service-platform.md#L25))에서는 범위에서 제외됨 | [README.md#L124](../../../README.md#L124), [README.md#L201-L213](../../../README.md#L201-L213) |

---

## 4. 핵심 용어

- **NaruWorks**: 직접 서비스(드라이브·문서관리·캘린더)와 연동 오픈소스 서비스를 회원·인증·드라이브 중심으로 묶어 제공하는 플랫폼 ([README.md#L18](../../../README.md#L18))
- **직접 서비스**: NaruWorks가 자체 개발·제공하는 서비스. 문서상 드라이브, 문서관리, Naru Calendar로 정의됨 ([README.md#L30](../../../README.md#L30), [open-source-integration.md#L17](../../../docs/architecture/open-source-integration.md#L17))
- **오픈소스 서비스**: 외부 오픈소스를 NaruWorks 회원 정보·화면 규칙·드라이브 저장 기준에 맞춰 연동해 제공하는 서비스(예: Litpage) ([README.md#L49-L58](../../../README.md#L49-L58), [open-source-integration.md#L18](../../../docs/architecture/open-source-integration.md#L18))
- **오픈소스 카탈로그**: 연동된 오픈소스 소프트웨어 목록. 사용자가 원하는 서비스를 골라 쓰거나 없는 서비스의 사용을 신청하는 창구 ([README.md#L31](../../../README.md#L31), [open-source-integration.md#L19](../../../docs/architecture/open-source-integration.md#L19))
- **연동**: 외부 오픈소스가 NaruWorks의 로그인(OIDC/`member` 역할), 화면 가이드라인(상단 바·하단 가이드라인), 나루 드라이브 저장을 따르게 만드는 작업 ([README.md#L51-L58](../../../README.md#L51-L58), [open-source-integration.md#L20](../../../docs/architecture/open-source-integration.md#L20))
- **나루 드라이브**: 모든 직접·오픈소스 서비스의 결과물이 저장되는 공용 저장소(기본 5GB 무료, 초과 시 요금제) ([README.md#L18](../../../README.md#L18), [README.md#L62-L63](../../../README.md#L62-L63))
- **공통 인증 게이트 (제안)**: 서비스가 10개 이상으로 늘 때 서비스마다 OIDC·세션·Back-channel logout을 중복 구현하지 않기 위해 앞단에 두는 인증 프록시(oauth2-proxy 또는 Cloudflare Access 검토 중) ([open-source-integration.md#L79-L84](../../../docs/architecture/open-source-integration.md#L79-L84))

---

## 5. 빈칸·모순·모호한 점

1. **문서관리 서비스의 정체성 모호 (직접 서비스 vs 오픈소스 서비스)**
   - `README` 상단에서는 "드라이브, 문서관리, Naru Calendar"를 **직접 제공하는 서비스**로 분류하지만, 현재 상태 표에서는 문서관리를 **오픈소스 Litpage 연동**으로 적고 있음. `open-source-integration.md`에서도 두 분류에 동시에 등장함.
   - 근거: [README.md#L18](../../../README.md#L18), [README.md#L30](../../../README.md#L30), [README.md#L75](../../../README.md#L75), [open-source-integration.md#L17-L18](../../../docs/architecture/open-source-integration.md#L17-L18)

2. **소셜 로그인 범위 불일치 (README "다양한 소셜 로그인" vs 실제 Google 단일 지원)**
   - `README`는 "다양한 소셜 로그인"을 제공한다고 설명하나, 현재 상태 및 IdP 문서는 Google 단일 로그인만 운영 중임. 재구축 시 어떤 소셜 제공자를 1차에 지원할지 빈칸.
   - 근거: [README.md#L32](../../../README.md#L32), [README.md#L72](../../../README.md#L72), [idp-keycloak-architecture.md#L12](../../../docs/architecture/idp-keycloak-architecture.md#L12)

3. **회원 가입·승인 정책 문서 간 모순 (`PENDING` vs 즉시 `APPROVED`)**
   - `README`에는 초대·승인 규칙이 생략되어 있고, `docs/` 내부에서도 `open-source-integration.md`는 "약관 동의 시 `PENDING` 저장 → 관리자 승인 시 `APPROVED`"로, `auth-membership-google-approval.md`는 "유효 초대 코드+약관 동의 시 즉시 `APPROVED` 생성(`PENDING`은 예약 상태)"으로 서로 다르게 기술됨.
   - 근거: [open-source-integration.md#L53](../../../docs/architecture/open-source-integration.md#L53), [open-source-integration.md#L88](../../../docs/architecture/open-source-integration.md#L88), [auth-membership-google-approval.md#L29](../../../docs/architecture/auth-membership-google-approval.md#L29), [auth-membership-google-approval.md#L99-L100](../../../docs/architecture/auth-membership-google-approval.md#L99-L100)

4. **오픈소스 연동 핵심 조건 3가지(라이선스·하단 가이드라인·드라이브 저장 방식)가 미결**
   - `README`에 연동 4대 조건이 적혀 있으나, ① 허용 라이선스 목록, ② 하단 서비스 가이드라인 내용, ③ 오픈소스의 나루 드라이브 저장 방식(API 연동 vs 파일시스템 마운트 등)이 모두 미결 상태.
   - 근거: [README.md#L55-L58](../../../README.md#L55-L58), [0002-open-source-service-platform.md#L40-L43](../../../docs/decisions/0002-open-source-service-platform.md#L40-L43), [open-source-integration.md#L28-L32](../../../docs/architecture/open-source-integration.md#L28-L32), [open-source-integration.md#L107](../../../docs/architecture/open-source-integration.md#L107)

5. **"같은 파일 형식으로 이어서 작업"하는 구체적 메커니즘 부재**
   - 서비스 교체 시 동일 확장자로 이어서 작업한다는 핵심 가치에 비해, 지원 파일 형식 표준(예: `.md`, `.hwp`/`.hwpx` 등), 파일 동시 수정·잠금·버전 충돌 처리 정책이 없음.
   - 근거: [README.md#L43](../../../README.md#L43), [README.md#L64](../../../README.md#L64), [open-source-platform-roadmap.md#L26](../../../docs/roadmap/open-source-platform-roadmap.md#L26)

6. **인증·세션 통합 아키텍처 및 Rust 재구축 시 IdP 유지 여부 미결**
   - 현재 서비스별 세션·로그아웃 불일치(#80)가 미해결이며, 공통 인증 게이트(oauth2-proxy vs Cloudflare Access) 도입 여부도 미결정. 또한 백엔드를 Rust로 새로 만들 때 Keycloak을 계속 쓸지 여부도 문서에 없음(기존 문서는 Spring Boot + Next.js 전제).
   - 근거: [README.md#L77](../../../README.md#L77), [README.md#L112](../../../README.md#L112), [open-source-integration.md#L59-L101](../../../docs/architecture/open-source-integration.md#L59-L101), [platform-overview.md#L32-L33](../../../docs/architecture/platform-overview.md#L32-L33)

7. **요금제·결제 수단 및 5GB 초과 시 동작 규칙 부재**
   - 5GB 초과 시 유료 요금제 가격·과금 주기·결제 수단(PG/StablePay 등)이 미정이며, 용량 초과 시 업로드 차단·읽기 전용 전환·유예 기간 등 업무 규칙도 없음.
   - 근거: [README.md#L62-L63](../../../README.md#L62-L63), [open-source-platform-roadmap.md#L16](../../../docs/roadmap/open-source-platform-roadmap.md#L16), [service-boundaries.md#L40-L42](../../../docs/architecture/service-boundaries.md#L40-L42)

8. **오픈소스 카탈로그·사용 신청의 기능 및 운영 규칙 빈칸**
   - 사용자가 카탈로그에서 "골라서 쓴다"는 것이 개인별 앱 활성화(구독/권한 부여)인지 단순 바로가기 목록인지, 신청 후 심사·반려 기준 및 통지 방식이 정의되지 않음.
   - 근거: [README.md#L31](../../../README.md#L31), [README.md#L40](../../../README.md#L40), [0002-open-source-service-platform.md#L42](../../../docs/decisions/0002-open-source-service-platform.md#L42)

9. **회원 정지·탈퇴 시 데이터 보관/파기 기준 미정**
   - 정지·탈퇴 시 "접근을 막고 데이터는 지우지 않는다"고만 정해져 있어, 탈퇴 회원의 개인정보 파기 기간·드라이브 파일 소유권 및 삭제 정책이 모호함.
   - 근거: [open-source-integration.md#L30](../../../docs/architecture/open-source-integration.md#L30)

10. **README 하단 '초기 기획 기록'과 상단 방향의 혼재 및 드라이브 개발용 스토리지 한계**
    - README 하단([README.md#L116-L213](../../../README.md#L116-L213))에 구 Spring Boot/Next.js/StablePay 기반 기획이 남아 있어 새 기획 기준과 혼동될 여지가 있음. 또한 드라이브 문서상 현재 RustFS는 개발 전용이며 운영 보관/백업 기준이 미확정.
    - 근거: [README.md#L116-L213](../../../README.md#L116-L213), [naru-drive/README.md#L24](../../../docs/services/naru-drive/README.md#L24)

---

## 6. 인터뷰 질문 후보

### 6-1 문제와 대상 사용자
- **Q-후보-01**: 1차 출시 시점의 실제 목표 사용자는 "초대받은 지인 그룹"인가요, 아니면 "불특정 일반 대중"인가요?
  - 왜 필요한지: 초대제 유지 여부와 초기 트래픽·운영 지원 수준을 결정하기 위함.
  - 근거 위치: [README.md#L24](../../../README.md#L24), [auth-membership-google-approval.md#L5-L6](../../../docs/architecture/auth-membership-google-approval.md#L5-L6)
- **Q-후보-02**: 일반 사용자가 느끼는 가장 큰 페인포인트는 "설치(Git/Docker)의 어려움"인가요, 아니면 "여러 서비스 간 파일 파편화"인가요?
  - 왜 필요한지: 1차 출시에서 카탈로그(앱 실행)와 드라이브(파일 호환) 중 어디에 기획 무게를 둘지 정하기 위함.
  - 근거 위치: [README.md#L22-L24](../../../README.md#L22-L24), [README.md#L42-L43](../../../README.md#L42-L43)
- **Q-후보-03**: 사용자가 "오픈소스를 신청"할 때 기대하는 리드타임(며칠 내 연동 등)과 심사 기준은 어느 정도인가요?
  - 왜 필요한지: 신청 기능의 기대치 관리와 운영자 심사 워크플로우 수준을 정하기 위함.
  - 근거 위치: [README.md#L31](../../../README.md#L31), [open-source-integration.md#L37-L42](../../../docs/architecture/open-source-integration.md#L37-L42)

### 6-2 범위(1차 출시에 넣을 것·뺄 것)
- **Q-후보-04**: Rust 백엔드로 새로 재구축할 때, 1차 출시(MVP)에 포함할 서비스는 무엇이고 뒤로 뺄 것은 무엇인가요? (드라이브 / 캘린더 / Litpage / 카탈로그·신청 / 요금제)
  - 왜 필요한지: 기존 Spring/Next.js 코드를 버리고 재구축하므로 1차 범위(PRD/FRD)를 명확히 자르기 위함.
  - 근거 위치: [README.md#L70-L77](../../../README.md#L70-L77), [open-source-platform-roadmap.md#L9-L16](../../../docs/roadmap/open-source-platform-roadmap.md#L9-L16)
- **Q-후보-05**: "문서관리"는 NaruWorks가 직접 만드는 별도 서비스인가요, 아니면 Litpage 같은 오픈소스 연동으로만 제공하나요?
  - 왜 필요한지: 직접 서비스 개발 범위와 오픈소스 연동 범위가 문서상 겹쳐 있어 책임 경계를 확정하기 위함.
  - 근거 위치: [README.md#L30](../../../README.md#L30), [README.md#L75](../../../README.md#L75)
- **Q-후보-06**: 기존에 운영 중이던 Keycloak과 수정된 Litpage(`services/litpage`)는 새 Rust 플랫폼에서도 그대로 유지·연동하나요, 아니면 인증·연동 구조도 새로 잡나요?
  - 왜 필요한지: 소셜 로그인 설정만 이어받을 때 IdP/연동 앱의 재사용 여부를 확정해야 아키텍처와 FRD가 나오기 때문.
  - 근거 위치: [README.md#L72-L75](../../../README.md#L72-L75), [idp-keycloak-architecture.md#L10-L14](../../../docs/architecture/idp-keycloak-architecture.md#L10-L14)
- **Q-후보-07**: Naru Calendar의 기존 기능(개인/공유 캘린더, 반복·음력·공휴일, Google Calendar 다중 계정 동기화)을 1차에 전부 재구현하나요, 아니면 축소하나요?
  - 왜 필요한지: Calendar 도메인 스펙이 방대해 1차 재구축 공수와 우선순위를 정해야 하기 때문.
  - 근거 위치: [README.md#L73](../../../README.md#L73), [naru-calendar/README.md#L17-L31](../../../docs/services/naru-calendar/README.md#L17-L31)
- **Q-후보-08**: 1차 출시에서 "5GB 초과 유료 요금제·결제"를 바로 넣나요, 아니면 무료 5GB(또는 베타)로만 출시하나요?
  - 왜 필요한지: 결제 수단(StablePay 포함 여부, PG 등)과 정산 요구사항의 1차 포함 여부를 결정하기 위함.
  - 근거 위치: [README.md#L62-L63](../../../README.md#L62-L63), [open-source-platform-roadmap.md#L16](../../../docs/roadmap/open-source-platform-roadmap.md#L16)

### 6-3 서비스별 기능
- **Q-후보-09**: 오픈소스 서비스가 나루 드라이브에 결과물을 저장할 때, 어떤 연동 방식을 표준으로 삼을 계획인가요? (드라이브 REST API 직접 호출 / WebDAV·S3 호환 / 공유 볼륨 마운트 등)
  - 왜 필요한지: 모든 오픈소스가 드라이브를 공유하는 핵심 구조인데 연동 방식이 미결이기 때문.
  - 근거 위치: [README.md#L58](../../../README.md#L58), [open-source-integration.md#L107](../../../docs/architecture/open-source-integration.md#L107)
- **Q-후보-10**: 나루 드라이브의 "다른 서비스로 이어서 작업" 기능은 1차에서 어떤 파일 형식(예: Markdown, 이미지, PDF, HWPX)과 어떤 UX(드라이브에서 '연결된 앱으로 열기' vs 앱 내부 파일 탐색기)로 제공하나요?
  - 왜 필요한지: 파일 호환성과 앱 간 이동 플로우를 구체화해 User Flow를 그리기 위함.
  - 근거 위치: [README.md#L43](../../../README.md#L43), [open-source-platform-roadmap.md#L26](../../../docs/roadmap/open-source-platform-roadmap.md#L26)
- **Q-후보-11**: 나루 드라이브 1차에 회원 간 파일 공유·공유 링크·파일 버전·미리보기 기능이 필요한가요, 아니면 기존 Drive MVP처럼 개인 폴더·업로드·다운로드·휴지통만 넣나요?
  - 왜 필요한지: 문서관리·오픈소스 결과물 활용 시 공유/미리보기 필요 여부에 따라 API와 화면 범위가 크게 달라짐.
  - 근거 위치: [naru-drive/README.md#L14-L22](../../../docs/services/naru-drive/README.md#L14-L22), [open-source-integration.md#L116](../../../docs/architecture/open-source-integration.md#L116)
- **Q-후보-12**: 오픈소스 카탈로그에서 사용자가 서비스를 "선택"하면 어떤 동작이 일어나나요? (개인 계정에 앱 권한 활성화 / 즐겨찾기 추가 / 바로 실행)
  - 왜 필요한지: 카탈로그의 핵심 기능 정의가 현재 설계 전 단계로 비어 있기 때문.
  - 근거 위치: [README.md#L31](../../../README.md#L31), [README.md#L40](../../../README.md#L40)
- **Q-후보-13**: 소셜 로그인은 1차에 Google만 지원하나요, 아니면 카카오·네이버·GitHub 등 다른 소셜 로그인도 함께 넣나요?
  - 왜 필요한지: README의 "다양한 소셜 로그인" 표현과 현재 Google 단일 구현 사이의 간극을 해소하기 위함.
  - 근거 위치: [README.md#L32](../../../README.md#L32), [README.md#L72](../../../README.md#L72)

### 6-4 업무 규칙(요금제·용량·권한 등)
- **Q-후보-14**: 신규 회원 가입 시 "유효한 초대 코드 + 약관 동의"만으로 즉시 `APPROVED`가 되나요, 아니면 관리자 최종 승인(`PENDING` → `APPROVED`)을 거쳐야 하나요?
  - 왜 필요한지: 두 설계 문서가 서로 상반된 상태 전이 규칙을 적고 있어 단일 업무 규칙으로 확정해야 하기 때문.
  - 근거 위치: [open-source-integration.md#L53](../../../docs/architecture/open-source-integration.md#L53), [auth-membership-google-approval.md#L29](../../../docs/architecture/auth-membership-google-approval.md#L29)
- **Q-후보-15**: 기본 5GB 용량 계산에 포함되는 범위(휴지통 파일, 오픈소스 내부 DB/첨부파일 포함 여부)와 5GB 초과 시 시스템 제한(업로드만 차단 / 오픈소스 저장 실패 처리 / 유예 기간)은 어떻게 되나요?
  - 왜 필요한지: 드라이브 용량(Quota) 정책과 오픈소스 서비스 연동 시 예외 처리 규칙을 정의하기 위함.
  - 근거 위치: [README.md#L62-L63](../../../README.md#L62-L63), [open-source-platform-roadmap.md#L13](../../../docs/roadmap/open-source-platform-roadmap.md#L13)
- **Q-후보-16**: 회원이 정지(`SUSPENDED`)되거나 탈퇴할 때 데이터 보관 기간과 개인정보 파기, 공유 데이터/오픈소스 내 데이터 처리는 어떻게 하나요?
  - 왜 필요한지: "데이터는 지우지 않는다"는 원칙과 개인정보 보호·저장 공간 회수 사이의 규칙이 비어 있기 때문.
  - 근거 위치: [open-source-integration.md#L30](../../../docs/architecture/open-source-integration.md#L30)
- **Q-후보-17**: 오픈소스 연동 시 허용할 라이선스 목록(예: MIT, Apache-2.0 허용 / AGPL 제외 등)과 상업적 요금제 제공 시 제약 기준은 무엇인가요?
  - 왜 필요한지: 유료 드라이브 요금제와 결합된 플랫폼에서 법적·라이선스 리스크가 없는 후보만 심사·온보딩하기 위함.
  - 근거 위치: [README.md#L55](../../../README.md#L55), [0002-open-source-service-platform.md#L40](../../../docs/decisions/0002-open-source-service-platform.md#L40)

### 6-5 비기능(보안·성능·가용성·개인정보)
- **Q-후보-18**: 통합 인증·로그아웃(#80)을 풀기 위해 공통 인증 게이트(oauth2-proxy 또는 Cloudflare Access)를 도입하나요, 아니면 각 서비스별 OIDC + Back-channel logout으로 가나요?
  - 왜 필요한지: Rust 백엔드 및 향후 오픈소스 10개 이상 확장을 전제로 인증·보안 아키텍처 NFR을 확정하기 위함.
  - 근거 위치: [README.md#L77](../../../README.md#L77), [open-source-integration.md#L79-L97](../../../docs/architecture/open-source-integration.md#L79-L97)
- **Q-후보-19**: 회원 정지 시 오픈소스 서비스 세션 차단 목표 시간(수 초 이내 vs 최대 5분)과 SSO 유지 시간(Idle 7일 / Max 30일 제안)을 그대로 NFR로 확정할까요?
  - 왜 필요한지: 보안(즉시 차단)과 사용자 편의(재로그인 주기) 간의 수치 기준을 확정하기 위함.
  - 근거 위치: [open-source-integration.md#L72-L78](../../../docs/architecture/open-source-integration.md#L72-L78)
- **Q-후보-20**: 홈서버 단일 환경에서 운영할 때, 나루 드라이브 파일과 DB의 백업 주기·복구 목표(RPO/RTO) 및 최대 파일 업로드 크기 제한은 어떻게 잡나요?
  - 왜 필요한지: 개발용 스토리지(RustFS)에서 운영 수준 저장소로 전환하기 위한 가용성·성능 기준이 필요하기 때문.
  - 근거 위치: [naru-drive/README.md#L24](../../../docs/services/naru-drive/README.md#L24), [platform-overview.md#L42-L44](../../../docs/architecture/platform-overview.md#L42-L44)
- **Q-후보-21**: 오픈소스 서비스 간(예: Litpage) 사용자 데이터 격리와 외부 공유 링크(익명 접근) 허용 정책의 보안 기준은 무엇인가요?
  - 왜 필요한지: 한 플랫폼에서 여러 오픈소스를 호스팅할 때 테넌트/사용자 격리 및 외부 노출 통제 기준이 필요하기 때문.
  - 근거 위치: [open-source-integration.md#L33](../../../docs/architecture/open-source-integration.md#L33), [open-source-integration.md#L116](../../../docs/architecture/open-source-integration.md#L116)

### 6-6 화면 흐름
- **Q-후보-22**: 모든 오픈소스 서비스에 공통 적용할 "상단 NaruWorks 바"와 "하단 서비스 가이드라인"에는 구체적으로 어떤 메뉴·링크·법적 고지가 들어가야 하나요?
  - 왜 필요한지: 와이어프레임과 오픈소스 UI 수정 가이드의 공통 기준을 확정하기 위함.
  - 근거 위치: [README.md#L57](../../../README.md#L57), [open-source-integration.md#L31](../../../docs/architecture/open-source-integration.md#L31)
- **Q-후보-23**: 로그인 직후 사용자가 처음 마주하는 메인 홈 화면의 중심은 무엇인가요? (오픈소스 카탈로그 / 내 서비스 런처 / 나루 드라이브 최근 파일 대시보드)
  - 왜 필요한지: 플랫폼의 첫 진입점과 핵심 User Flow(탐색 → 실행 → 저장)의 동선을 설계하기 위함.
  - 근거 위치: [README.md#L12-L14](../../../README.md#L12-L14), [README.md#L39-L43](../../../README.md#L39-L43)
- **Q-후보-24**: 초대 링크 없이 일반 접속한 미가입 사용자에게 보여줄 화면(안내 페이지 vs 초대 코드 입력 vs 대기자 신청)과 약관 동의 화면 흐름은 어떻게 되나요?
  - 왜 필요한지: 비회원 진입 경로의 예외 화면과 가입 전환 플로우를 빠짐없이 설계하기 위함.
  - 근거 위치: [auth-membership-google-approval.md#L58-L68](../../../docs/architecture/auth-membership-google-approval.md#L58-L68), [open-source-integration.md#L88](../../../docs/architecture/open-source-integration.md#L88)

---

## 7. 가장 먼저 물어볼 질문 Top 5

1. **Q-후보-04 (1차 출시 범위: 재구축할 서비스와 제외할 서비스 확정)**
   - 이유: 기존 코드를 버리고 Rust 백엔드로 새로 시작하는 시점이므로, 1차 PRD/FRD에 무엇을 넣고 뺄지 정해야 모든 후속 기획의 경계가 서기 때문이다.
2. **Q-후보-06 & Q-후보-18 (인증·IdP·공통 게이트 구조 확정)**
   - 이유: 기존 Keycloak/Litpage 유지 여부와 통합 로그인·로그아웃(#80)·회원 정지 차단 구조가 정해져야 회원·오픈소스 연동·보안 NFR 전체를 설계할 수 있기 때문이다.
3. **Q-후보-09 (오픈소스 ↔ 나루 드라이브 저장 연동 방식 확정)**
   - 이유: "모든 결과물을 나루 드라이브에 저장하고 파일 형식으로 이어 쓴다"가 플랫폼의 핵심 가치이자 기술적 핵심이므로, 저장 연동 프로토콜(API/마운트 등)이 확정되어야 드라이브와 카탈로그 스펙을 짤 수 있기 때문이다.
4. **Q-후보-14 (회원 가입·승인 규칙 모순 해소: 즉시 승인 vs 관리자 승인)**
   - 이유: 설계 문서 두 곳에서 초대 가입 후 상태 전이(`APPROVED` vs `PENDING`)가 충돌하고 있어, 인증·관리자 화면·권한 규칙을 쓰기 전에 반드시 하나로 통일해야 하기 때문이다.
5. **Q-후보-05 (문서관리 서비스의 위치 확정: 직접 서비스 vs Litpage 오픈소스)**
   - 이유: README 내에서조차 문서관리가 직접 서비스와 오픈소스 연동으로 겹쳐 있어, 자체 개발 범위를 오판하지 않기 위해 가장 먼저 정리해야 하기 때문이다.

---

## 8. 확인하지 못한 것 (`[미확인]`)

- `[미확인]` [README.md#L12](../../../README.md#L12), [README.md#L37](../../../README.md#L37), [README.md#L47](../../../README.md#L47)에 삽입된 이미지(`home-demo.png`, `naruworks-service-flow.png`, `naruworks-architecture.png`) 내부에 표시된 세부 UI 요소 및 텍스트.
- `[미확인]` `services/litpage/NARU.md`, `infra/README.md`, `docs/프로젝트_운영_메모리.md`, `docs/services/naru-drive/` 세부 문서(`mvp-domain-model.md`, `mvp-api-contract.md`, `storage-and-transfer.md`) 및 `docs/services/naru-calendar/` 세부 문서 전체 내용.
- `[미확인]` GitHub 이슈 `#73`, `#76`, `#77`, `#80`의 실제 본문과 최신 논의 내용(저장소 외부 링크).
- `[미확인]` 기존 도메인 구성, Cloudflare Tunnel/Access 설정, 소셜 로그인 OAuth 클라이언트 콘솔 설정 및 `.env` 비밀값(작업 규칙상 비밀 파일 미열람).
- `[미확인]` 새 플랫폼에서 사용할 프런트엔드 기술 스택, Rust 백엔드 프레임워크·저장소 구조, 기존 Keycloak 및 `services/litpage` 코드의 재사용/폐기 여부.
