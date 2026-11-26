# ADR 0004 - 인증/IdP와 Litpage 연동

날짜: 2026-11-19

상태: 승인됨 (2026-11-19 15:07 KST 호배님)

문서 개정: 2 · 2026-11-26 21:45 KST, 호배님 Litpage SSO 결정 반영 (기획 기준선 develop `2f1db92`)

## 개정 이력

| 개정 | 일시 | 내용 |
|---|---|---|
| 1 | 2026-11-26 (KST) | 승인된 인증/IdP·Litpage 결정을 기록하고 05·06·06F에 연결. SSO와 무손실 패키징 추천 및 검증 조건 기록. |
| 2 | 2026-11-26 21:45 KST | 호배님 결정으로 Litpage SSO B-1 채택, B-2 기각. |

## 결정

### 승인된 사항

- 선택지 B를 채택한다. Keycloak과 전용 DB를 제거한다. 나루 백엔드가 Google 로그인을 직접 연동하고, 나루 PostgreSQL에서 회원 상태와 세션을 관리한다. 가입은 관리자 승인 없이 즉시 이루어지며, 정지에 따른 접근 차단은 아래 정책을 따른다. [FRD FR-AUTH-001·005](../01-planning/frd/FRD.md), [기획 결정 로그](../01-planning/02-decision-log/decision-log.md)
- Litpage의 인증 연결 계층을 새로 붙인다. 기존 Keycloak OIDC RP 코드(`oidc.ts` 등)와 기존 로컬 세션의 인증 연결을 재사용하지 않는다. 이 결정의 범위는 로그인·세션·로그아웃의 연결 계층이다. 나루 상단 바 등 UI 틀과 비밀번호 로그인 비활성화는 유지한다. [Litpage NARU.md](../../services/litpage/NARU.md), [나루 상단 바 적용 코드](../../services/litpage/apps/web/src/App.tsx)
- 문서 본문은 Markdown, 데이터베이스 표는 CSV로 사용자 지정 나루 드라이브 폴더에 저장한다. 드라이브에서 Litpage로 다시 열어 편집할 때 **손실 없어야 함**이 채택 조건이다. 패키징 확정은 왕복 검증 스파이크 합격에 달려 있다. 오브젝트 저장소 구현은 별도 ADR에서 다룬다. [FRD FR-OSS-001~003·FR-DRV-005](../01-planning/frd/FRD.md), [AC-FR-OSS-003-01·AC-FR-DRV-005-01](../01-planning/acceptance-criteria/AC.md)
- 기존 Keycloak DB와 회원 DB의 데이터는 이전하지 않는다. 이어받는 대상은 도메인(CO-01)과 Cloudflare 설정(CO-02)의 보관 위치인 Cloudflare 대시보드, 소셜 로그인 설정의 보관 위치인 **CO-03 Google Cloud Console**이다. [DEC-082](../01-planning/02-decision-log/decision-log.md), [이어받는 설정 CO-01~03](../01-planning/carry-over/README.md), [NFR-SEC-005](../01-planning/nfr/NFR.md), [AC-NFR-SEC-005-02](../01-planning/acceptance-criteria/AC.md)
- **Litpage SSO는 B-1로 결정했다(2026-11-26 21:45 KST 호배님).** 나루 axum이 얇은 OIDC 제공자(OP)로 동작하고 Litpage는 새 RP로 연동한다. [09 인증 설계](../02-architecture/09-auth.md#4-litpage-sso)

백엔드는 ADR 0003의 axum 0.8.x, sqlx 0.8.x와 `sqlx migrate`, utoipa 5.x, tracing과 tower-http, tokio 1.x를 따른다. 스파이크가 해석한 패치 버전은 고정하지 않는다. [ADR 0003](0003-backend-stack.md)

### 추천 사항

- **무손실 패키징은 ZIP 사이드카를 추천한다.** 사용자용 Markdown·CSV와 연결된 ZIP에 복원용 메타데이터와 첨부를 담거나, 한 ZIP 번들에 Markdown·CSV와 부가 파일을 함께 담는다. 실제 무손실 여부와 구체적인 패키징 계약은 [미확인]이다. [Gemini 검토 §6·§9](../02-architecture/_reviews/09-auth-options-gemini.md)

## 배경

DEC-008은 통합 인증 구현 방식을 기획에서 설계 ADR로 이관했다. 1차는 지인 위주 사용자 100명 이내와 동시 접속 20명을 기준으로 하며, 06F는 단일 서버를 설계 가정으로 두었다. [DEC-008·088](../01-planning/02-decision-log/decision-log.md), [NFR-PERF-001·004](../01-planning/nfr/NFR.md), [06F §11.3 AS-A4](../02-architecture/06F-stack-feasibility.md)

현재 Litpage는 Keycloak의 OIDC RP로, authorization code와 PKCE를 사용하고 `member` 역할 및 검증된 이메일을 확인한다. Keycloak의 `sub`를 Litpage 사용자와 연결한 뒤 `lit_session` 쿠키와 SQLite 세션을 만든다. 코드는 생성 시점에 기본 7일 만료를 기록하며 요청에 따라 유휴 만료를 연장하거나 절대 30일 상한을 적용하는 처리는 확인되지 않았다. 콘텐츠는 SQLite `records` 테이블에 JSON으로 저장된다. 실제 Keycloak 연동 종단 시험은 NARU.md에 남은 일로 기록되어 있고, 나루 드라이브 자동 저장 경로는 [미확인] 상태다. [NARU.md](../../services/litpage/NARU.md), [oidc.ts](../../services/litpage/apps/server/src/oidc.ts), [auth.ts](../../services/litpage/apps/server/src/auth.ts), [db.ts](../../services/litpage/apps/server/src/db.ts), [Gemini 검토 §5·§6](../02-architecture/_reviews/09-auth-options-gemini.md)

## 이유

나루가 세션과 회원 상태를 한 PostgreSQL에서 관리하면 로그인·갱신·진입 시 같은 상태를 기준으로 판단할 수 있다. 단일 서버에서 Keycloak과 전용 DB의 상시 운영 및 회원 상태 동기화 부담을 줄인다. Google 인증 응답 검증, 세션 발급·갱신·폐기, Litpage 연계의 구현과 보안 검증은 나루가 맡는다.

Litpage에 인증을 새로 붙이면 Keycloak 역할 클레임과 로그아웃 방식에 맞춘 가정을 이어받지 않고, 나루의 기기별 로그아웃과 최신 회원 상태 판정을 인증 경계에 반영할 수 있다. 드라이브에서는 Markdown·CSV의 가독성과 이식성을 살려 향후 오픈소스 교체에 대비한다. 복원에 필요한 고유 속성은 별도로 보존해 드라이브에서 다시 열어 이어서 편집할 수 있게 한다. [DEC-026](../01-planning/02-decision-log/decision-log.md), [FRD FR-DRV-005](../01-planning/frd/FRD.md)

## 검토한 대안

### IdP와 Keycloak 제거

| 대안 | 판단 |
|---|---|
| Keycloak 유지 | 표준 OIDC 연계와 현재 Litpage RP를 활용할 수 있다. 전용 DB 운영 및 나루 회원 상태·세션과의 동기화 부담 때문에 기각했다. |
| 외부 관리형 IdP | IdP 운영 일부를 위임할 수 있다. 나루 회원 정지와 기기별 세션 종료를 맞추는 별도 연계와 외부 의존이 남아 기각했다. 공급자별 동작·비용은 [미확인]이다. |
| 나루 자체 인증(axum)과 Keycloak 제거 | 채택했다. Google 로그인, 회원 상태, 세션 수명과 취소를 나루에서 제어한다. 직접 구현·검증 비용을 감수한다. |

전환 시 기존 DB를 통째로 옮기는 안은 기존 스키마와 인증 데이터를 옮기는 부담이 있어 기각했다. 기존 회원·식별자만 선별 이관하는 안도 기존 계정 연결의 대응 관계를 검증해야 하므로 기각했다. 승인된 이관 범위는 CO-01~03의 보관 위치다.

### Litpage 인증 연결

| 대안 | 판단 |
|---|---|
| 기존 Keycloak OIDC 코드를 유지하고 접속 대상만 교체 | 초기 수정량을 줄일 수 있지만 역할 클레임, 로컬 세션, 로그아웃의 Keycloak 가정을 함께 보수해야 하므로 기각했다. |
| 업스트림부터 다시 적용 | 인증과 무관한 상단 바와 비밀번호 로그인 비활성화도 다시 적용해야 하므로 기각했다. |
| 현재 Litpage에 인증 연결 계층을 새로 작성 | 채택했다. 나루 수정분 중 UI와 비밀번호 로그인 비활성화를 유지하며 승인된 세션 정책에 맞춰 인증을 연결한다. |

### 드라이브 저장 형식

| 대안 | 판단 |
|---|---|
| Markdown·CSV | 무손실 재열기 조건으로 채택했다. 문서와 표를 범용 도구에서도 열 수 있고 기존 내보내기·가져오기 경로를 참고할 수 있다. |
| SQLite 또는 네이티브 레코드 스냅샷을 정규 파일로 사용 | Litpage 데이터 구조 보존에는 유리하지만 다른 도구나 교체 서비스에서 파일을 열어 이어 쓰기 어려워 기각했다. |
| HTML·PDF 출력물을 정규 파일로 사용 | 열람·인쇄에는 유용하지만 블록과 DB의 편집 가능한 구조를 보존하는 저장 형식으로 적합하지 않아 기각했다. |

### SSO 방식

| 대안 | 구현 비용과 표준성 | 정지와 로그아웃 |
|---|---|---|
| B-1 나루가 얇은 OIDC 제공자 역할 | **채택.** 표준 RP 연동을 활용하고 OIDC 기반 후속 오픈소스 서비스로 확장할 수 있다. OP의 토큰·키·로그아웃 기능과 Litpage RP를 새로 구현해야 한다. | 나루의 authorize·token·진입 경계에서 최신 정지를 적용한다. 현재 기기의 RP 세션까지 로그아웃을 전파하는 계약은 09를 따른다. 실제 동작과 전파 지연은 [미확인]이다. |
| B-2 공유 세션 또는 내부 SSO 토큰 | **기각.** 호배님이 2026-11-26 21:45 KST에 B-1을 선택했다. 공유 세션은 동일 오리진 및 사용자 콘텐츠 격리 부담이 있고, 내부 토큰은 표준 OIDC만 받는 후속 서비스마다 어댑터 또는 별도 제공자가 필요하다. | 별도의 서비스 간 신뢰 경계와 장기 연결의 세션 폐기 전파를 설계해야 하는 대안이었다. |

인증 크레이트 선정과 동작·취약점 검증은 [미확인]이며 [스파이크 필요]다. [09 인증 설계](../02-architecture/09-auth.md), [06F §11.1 U-14](../02-architecture/06F-stack-feasibility.md)

### 무손실 패키징

| 대안 | 판단 |
|---|---|
| Markdown 확장 문법·front matter | 메타데이터를 본문과 함께 보존할 수 있다. DB의 CSV와 다른 문서에 걸친 관계·뷰까지 하나의 문법으로 다뤄야 하고, 일반 편집기에서 확장 부분이 사라지거나 본문 가독성이 낮아질 수 있어 우선 추천에서 제외한다. |
| ZIP 사이드카 또는 ZIP 번들 내 부가 파일 | **추천.** Markdown·CSV는 사람이 읽을 수 있게 두고, 블록 ID·리치텍스트 속성·DB 수식·관계·뷰·댓글 등은 구조화된 부가 파일에서 복원한다. 서로 다른 저장 시점의 파일이 섞이지 않도록 같은 버전으로 묶고 일치 여부를 검사하는 방식을 검증한다. 메타데이터 스키마와 파일 연결 방식은 [미확인]이다. |

## 정지·세션·통합 로그아웃

| 정책 | 적용과 검증 |
|---|---|
| 정지 · DEC-098, NFR-SEC-002, BR-005 | 나루 백엔드는 재로그인·토큰 갱신·Litpage 신규 진입을 모두 새 로그인으로 판단한다. 세션이나 자격을 발급·갱신하기 전에 PostgreSQL에서 최신 회원 상태를 확인해 정지 회원을 차단한다. 정지만으로 이미 열린 세션을 즉시 종료하지 않는다. DEC-027의 기존 문구는 DEC-098로 정정됐다. GAP-012·034는 DEC-092·098로 해소됐다. |
| 세션 · DEC-092, NFR-SEC-006 | 나루 PostgreSQL에서 세션을 관리한다. 유휴 7일과 로그인 시작 후 절대 30일 중 먼저 도달하는 시점에 만료한다. 활동으로 유휴 기준은 갱신할 수 있고 절대 만료는 로그인 시작 시점을 기준으로 유지한다. 만료 후에는 재로그인이 필요하다. Litpage RP의 사용 가능 기간은 09 제안에 따라 나루 세션의 현재 만료를 넘지 않게 한다. 활동 시각 집계와 갱신 주기는 [미확인]이다. |
| 통합 로그아웃 · DEC-094, NFR-SEC-001, BR-004 | 나루는 현재 기기의 세션을 무효화하고, 그 세션에 연결된 Litpage 세션도 종료되게 한다. 같은 회원의 다른 기기 세션은 유지한다. 무효화 전파와 함께 기존 쿠키를 사용한 요청 및 재진입 거부를 검증한다. |
| PV-017·028 · 로그아웃 시험 | 04는 전파 p99 ≤5초, 로그아웃 API p95 ≤2초를 제안하며, 액세스 토큰 수명 ≤5분 또는 백채널 로그아웃을 후보로 둔다. 09의 제안은 짧은 토큰으로 갱신 경계를 두고, 나루에서 Litpage로는 백채널 통지를, Litpage에서 나루로는 RP 시작 로그아웃을 사용한다. 양쪽 시작 경로에서 현재 기기의 세션·웹소켓 폐기와 재진입 거부를 검증한다. 두 기기로 검증하고, PV-028에 따라 30회에서 전파 지연 최댓값 ≤5초와 API p95 ≤2초를 판정한다. 실측 결과는 [미확인]이다. |
| PV-018 · 정지 반영 시험 | 정지 기록 확정 직후 세 경로에서 PostgreSQL의 최신 상태를 읽어 모두 거부하는지 확인한다. 정지 확정에서 새 로그인 차단 반영까지 ≤5초는 04의 제안값이다. 이미 열린 세션이 다음 갱신 때 차단되기까지의 최대 시간은 Q-087 [미확인]이다. |
| PV-029 · 만료 경계 시험 | 주입 시계로 유휴 7일 직전 요청 시 세션 유지, 7일 무요청 시 만료, 지속 사용 중에도 로그인 시작 후 30일에 만료를 확인한다. 정지 후 열린 세션이 즉시 종료되지 않는지, 갱신과 Litpage 신규 진입은 거부되는지 별도로 확인한다. |

[기획 결정 로그](../01-planning/02-decision-log/decision-log.md), [NFR SEC](../01-planning/nfr/NFR.md), [FRD AUTH·OSS](../01-planning/frd/FRD.md), [BR-004·005](../01-planning/business-rules/BR.md), [AC-FR-AUTH-002·005, AC-NFR-SEC-001·002·006](../01-planning/acceptance-criteria/AC.md), [04 §4.4·§8.1](../02-architecture/04-NFR-technical.md)

## 무손실 왕복 검증 스파이크

현재 내보내기는 Markdown 본문, DB CSV와 행 페이지를 생성하며 첨부 포함 옵션이 있다. CSV는 표시용 값을 내보내고 Markdown은 일부 멘션을 표시 텍스트로 바꾼다. 댓글 렌더링은 HTML 쪽에 있다. ZIP 가져오기는 하위 페이지·내부 페이지 링크·이미지 일부를 재구성하며, 새 페이지 ID를 만들고 CSV의 데이터 타입을 추론해 기본 표 뷰를 구성한다. 기존 구현만으로 고유 속성을 복원할 수 있는지는 [미확인]이다. [export.ts](../../services/litpage/apps/server/src/api/modules/export.ts), [render.ts](../../services/litpage/apps/server/src/content/render.ts), [import.ts](../../services/litpage/apps/server/src/api/modules/import.ts), [csv.ts](../../services/litpage/apps/server/src/content/csv.ts), [spec.ts](../../services/litpage/apps/server/src/content/spec.ts)

원본을 편집 가능한 시험 문서로 만든다. 드라이브에 저장한 파일과 부가 파일만으로 재열 수 있도록 원본 SQLite 레코드에 의존하지 않는 환경에서 열고, 아래 속성을 비교한다. 각 유형에서 다시 편집하고 저장한 뒤 한 번 더 열어 변경분과 나머지 속성이 모두 보존되는지도 확인한다.

| 대상 문서 유형 | 비교할 속성 |
|---|---|
| 일반 문서와 하위 페이지 | 페이지·블록 식별자, 제목과 본문, 블록 종류·순서·중첩·부모 관계, 체크 상태·코드 언어 등 블록 속성, 내부 링크의 참조 대상. |
| 리치텍스트 및 첨부가 있는 문서 | 문자와 줄바꿈, 굵게·기울임·취소선·밑줄·코드·색상, 링크 목적지, 멘션 대상·날짜·수식 내용, 첨부 이름과 바이트 및 블록 연결. 이미지와 일반 파일을 각각 시험한다. |
| 인라인·전체 페이지 DB와 행 페이지 | 열 식별자·순서·타입·옵션, 행 식별자·순서·타입별 값과 행 본문, 제목이 같은 행의 연결, 수식 정의와 계산 결과, 양방향 관계의 대상과 롤업 설정·결과, 여러 뷰의 종류·열 표시·필터·정렬·그룹 설정. 뷰에서 숨겨진 접근 가능 행과 속성도 복원한다. |
| 페이지·블록·DB 속성에 댓글이 달린 문서 | 스레드와 댓글 식별자, 대상 블록·속성 및 인용 문맥, 댓글과 답글의 순서·본문·작성자·시각, 해결 상태. |
| 접근 권한이 다른 문서·DB 속성 | 기존 내보내기가 제외하는 읽기 권한 밖의 문서·행·속성이 Markdown·CSV·첨부·부가 파일을 통해 노출되거나 가져올 때 되살아나지 않는지 확인한다. |

[Litpage 레코드 모델](../../services/litpage/packages/shared/src/records.ts), [리치텍스트 모델](../../services/litpage/packages/shared/src/richtext.ts), [render.ts](../../services/litpage/apps/server/src/content/render.ts), [NARU.md](../../services/litpage/NARU.md)

**합격**은 표의 모든 유형에서 편집 가능한 상태로 열리고, 두 번의 재열기에서 비교 속성의 누락·변형·오연결과 권한 밖 데이터 노출이 모두 없는 경우다. 식별자를 재할당해야 하는 경우 원래 식별자를 보존한 일대일 대응과 모든 참조의 일관된 복원이 필요하다. **실패**는 비교 항목이 하나라도 손실되거나, 재편집할 수 없거나, 권한 밖의 데이터가 노출되는 경우다. 검증을 완료하지 못한 항목이 있으면 합격 처리를 보류한다. 버전 이력, 댓글 반응·제안, 외부 참조와 공유 설정 등 전체 보존 범위는 [미확인]이며, 스파이크에서 적용 범위를 확인한다.

스파이크가 실패하면 형식의 최종 채택을 보류하고 손실 항목과 재현 결과를 호배님께 보고해 다시 결정한다. 형식 2(네이티브 스냅샷·SQLite)로의 임의 전환은 금지한다. [Gemini 검토 §6·§9](../02-architecture/_reviews/09-auth-options-gemini.md)

## 후속

- 확정된 B-1을 [09 인증 설계](../02-architecture/09-auth.md)에 반영했다. 기기별 통합 로그아웃과 웹소켓을 포함한 세션 무효화, 갱신·만료 경계 및 PV-017·018·029를 검증한다. Litpage 종단 동작과 Rust 인증 크레이트의 선정·보안 검증은 [미확인]이다. [04 기술 NFR](../02-architecture/04-NFR-technical.md), [Litpage NARU.md](../../services/litpage/NARU.md)
- 왕복 스파이크를 수행한다. GAP-028의 IdP, Litpage 인증 재사용 여부, 저장 형식 방향은 이 ADR로 해소했다. 패키징 채택은 스파이크 결과를 기다린다. [06F §9](../02-architecture/06F-stack-feasibility.md)
- [미확인] RB-017 Cloudflare 프록시 경로·본문 한도와 1GB 단일 업로드의 충돌 여부, GAP-016 기본 보안선, GAP-018 지원 브라우저의 최신 기준, GAP-025 Litpage 자동 저장 지연·재시도·실패 정의 및 1GB 한도 적용. [04 기술 NFR](../02-architecture/04-NFR-technical.md)
- [미확인] Q-081 사업자·운영자 정보 표시의 법적 필요 여부, Q-085 달력 날짜 30일의 시간대·경계 시각·시작일, Q-087 열린 세션의 토큰 갱신 차단까지 최대 시간, Q-091 감사 기록 항목·보관 기간 및 로그 보관의 법적 적정성, Q-092 저장 용량 경보 기준·수신 대상·방법. [기획 열린 질문](../01-planning/02-decision-log/open-questions.md)
