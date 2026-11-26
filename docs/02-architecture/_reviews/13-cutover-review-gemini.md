<!-- naru-orch job=P2-13-cutover-review-gemini-01 provider=antigravity model=gemini-4-hydrogen-medium agent=c028b92e-275d-4165-8dd3-652fb576ffa7 saved=2026-11-26T22:08:40+09:00 -->

# 13 전환 절차(v0.1) 검토 결과

## 1. 요약

- **심각도별 개수**: blocking **0건** / major **0건** / minor **0건** (총 **0건**)
- **전면 교체·이관 없음**: 기존 Java 서비스에서 새 Rust 서비스로 전면 교체하며 병행 운영과 기존 DB 데이터 이관이 없음을 명확히 반영함 ([13-cutover.md](../../../docs/02-architecture/13-cutover.md#L19-L20)).
- **SSO B-1 정합**: 나루 OP + Litpage 새 RP(B-1)를 따르고 기존 Keycloak RP·로컬 세션 재사용 금지 및 Keycloak·전용 DB 제외를 명시함 ([13-cutover.md](../../../docs/02-architecture/13-cutover.md#L42)).
- **CO-01~03 위치만 기록**: Cloudflare 대시보드(CO-01·02)와 Google Cloud Console(CO-03) 보관 위치만 적고 도메인 값·토큰·클라이언트 ID·시크릿을 기재하지 않음 ([13-cutover.md](../../../docs/02-architecture/13-cutover.md#L25-L33)).
- **단계 완전성**: 사전 점검(§3.1) → 동결(§3.2) → 전환(§3.3) → 확인과 개방(§3.4) → 되돌리기(§3.5) 순서가 빠짐없이 구성됨 ([13-cutover.md](../../../docs/02-architecture/13-cutover.md#L35-L83)).
- **리허설**: 스테이징 또는 동등한 비운영 환경에서 운영 설정·데이터·트래픽을 바꾸지 않고 전환 및 롤백을 연습하는 절차를 포함함 ([13-cutover.md](../../../docs/02-architecture/13-cutover.md#L85-L93)).
- **남은 [미확인]**: RB-017, 배포·리허설 호스트·토폴로지·IaC, CO-03 재사용·재발급·URI 등록, 공지 시점·방법, 롤백 창·신 환경 기록 처리, 시드·헬스·B-1 실측 등을 §6에 정리함 ([13-cutover.md](../../../docs/02-architecture/13-cutover.md#L108-L117)).

---

## 2. 설계 결함 표

남은 blocking/major 없음.

---

## 3. 점검 목록

| 번호 | 검토 항목 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | 23장·기획 원칙 일치 | **충족** | [13-cutover.md §1·§4·§5](../../../docs/02-architecture/13-cutover.md#L17-L21)에서 전면 교체(병행 운영 없음), DB 이관 없음([PRD.md §7](../../../docs/01-planning/prd/PRD.md#L156)), 리허설(§4) 및 위험·대응(§5)을 모두 포함함. |
| 2 | SSO B-1 정합 | **충족** | [13-cutover.md §3.1·§3.3](../../../docs/02-architecture/13-cutover.md#L42)에서 나루 OP + Litpage 새 RP를 준비·연결하고 기존 Keycloak RP 코드·세션 비재사용을 명시했으며, 상세 계약은 [09-auth.md §3~5](../../../docs/02-architecture/09-auth.md#L135-L268)와 [ADR 0004](../../../docs/decisions/0004-auth-idp-litpage.md#L24)를 참조함. |
| 3 | CO-01~03·비밀 | **충족** | [13-cutover.md §2](../../../docs/02-architecture/13-cutover.md#L25-L33)에서 [carry-over/README.md](../../../docs/01-planning/carry-over/README.md#L7-L11) 및 [NFR-SEC-005](../../../docs/01-planning/nfr/NFR.md#L133-L138)에 맞춰 보관 위치만 적고 값·계정명·시크릿을 기재하지 않음. |
| 4 | 단계 완전성 | **충족** | 사전 점검(§3.1), 구 서비스 쓰기·가입 동결(§3.2), Rust·DB 기동→CO-02/01→CO-03→Litpage B-1 순서 전환(§3.3), Google 로그인·정지(DEC-098)·통합 로그아웃·Litpage 진입·저장·드라이브 업로드·공개 링크 확인(§3.4), 되돌리기(§3.5)를 모두 갖춤. |
| 5 | 명령·범위 | **충족** (이력은 `[미확인]`) | 실행 명령 블록 없이 체크리스트만 작성했고 미확인 항목을 단정하지 않음. 단, `.git` 부재로 타 문서 수정 여부는 `[미확인]`이나 파일 수정 시각상 `13-cutover.md`만 `22:04`로 가장 늦음. |
| 6 | 가용성·확인 | **충족** | [13-cutover.md §3.1](../../../docs/02-architecture/13-cutover.md#L43)에서 [NFR-AVAIL-001](../../../docs/01-planning/nfr/NFR.md#L149-L154)(DEC-089)의 미리 알린 점검을 전환 창·사전 공지와 연결하고 공지 시점·방법을 `[미확인]`으로 남겼으며, §3.4 `/livez`·`/readyz`는 [10-observability-ci.md §5](../../../docs/02-architecture/10-observability-ci.md#L65-L74)의 `**[제안]**`으로 인용함. |
| 7 | 위험 표와 리허설 | **충족** | [13-cutover.md §5](../../../docs/02-architecture/13-cutover.md#L97-L106)에서 전환 실패(`CUT-R-001`), CO-03(`CUT-R-002`), Litpage(`CUT-R-003`), 조기 Keycloak 제거(`CUT-R-004`), RB-017(`CUT-R-005`), 비밀 유출(`CUT-R-006`), 미공지 중단(`CUT-R-007`), 개방 후 롤백(`CUT-R-008`)을 다루고, [§4](../../../docs/02-architecture/13-cutover.md#L87)에서 비운영 리허설을 명시함. |

---

## 4. 되돌리기 기준 및 Keycloak 조기 제거 방지 확인

- **되돌리기 기준 포함 여부**: [13-cutover.md §3.5](../../../docs/02-architecture/13-cutover.md#L77)에서 전환 실패, §3.4 필수 확인 실패(롤백 시작 시점까지 미해소), Google 로그인 불가, Litpage 진입·저장 불가, 정지 차단·통합 로그아웃 실패를 개방 보류 및 롤백 기준으로 명시하고, 개방 후 롤백 창 내 동일 장애 발생 시에도 같은 기준을 적용하도록 함.
- **Keycloak 조기 제거 방지**:
  - [§1](../../../docs/02-architecture/13-cutover.md#L20): 구 스택과 Keycloak은 롤백에 대비해 보존.
  - [§3.3](../../../docs/02-architecture/13-cutover.md#L58): 구 Keycloak과 전용 DB의 중지·제거는 롤백 창 종료 뒤로 미룸.
  - [§3.4](../../../docs/02-architecture/13-cutover.md#L73): 롤백 창을 닫기로 결정한 뒤 구 Java 스택·Keycloak·전용 DB의 중지·제거 대상으로 넘김.
  - [§3.5](../../../docs/02-architecture/13-cutover.md#L80) 및 [§5 CUT-R-004](../../../docs/02-architecture/13-cutover.md#L102): 롤백 시 보존한 구 Keycloak·전용 DB·구 Litpage 인증 구성을 확인해 복귀하며, 조기 제거를 별도 위험으로 관리함.

---

## 5. 남은 `[미확인]` 목록 (13 §6과 원문 대조)

| 13 §6 항목 | 원문 대조 |
| --- | --- |
| RB-017 Cloudflare 프록시 경로·본문 한도와 1 GiB 단일 업로드 양립 여부 | 일치 ([04-NFR-technical.md §4.1](../../../docs/02-architecture/04-NFR-technical.md#L135), [07-api.md](../../../docs/02-architecture/07-api/07-api.md#L249), [08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L370), [09-auth.md §11](../../../docs/02-architecture/09-auth.md#L370), [10-observability-ci.md §10](../../../docs/02-architecture/10-observability-ci.md#L125)) |
| 배포·리허설 호스트, 배포 오리진·토폴로지·IaC, 이미지 레지스트리, 런타임 시크릿 위치, 점검·동결 적용 및 구 스택 보존 방식 | 일치 ([05-architecture.md §2](../../../docs/02-architecture/05-architecture.md#L54), [09-auth.md §11](../../../docs/02-architecture/09-auth.md#L384), [10-observability-ci.md §9~10](../../../docs/02-architecture/10-observability-ci.md#L117)) |
| CO 접근 권한자·교체 절차, CO-03 클라이언트 재사용·재발급, 기존 redirect URI 재사용·추가 등록 여부 | 일치 ([carry-over/README.md](../../../docs/01-planning/carry-over/README.md#L16), [09-auth.md §1·§11](../../../docs/02-architecture/09-auth.md#L27), [10-observability-ci.md §10](../../../docs/02-architecture/10-observability-ci.md#L132)) |
| NFR-AVAIL-001 사전 공지 시점·방법, 전환 창·롤백 시작·종료 시점 및 결정 담당자, 개방 뒤 롤백 시 새 환경 기록 후속 처리 | 일치 ([NFR.md §4.3](../../../docs/01-planning/nfr/NFR.md#L153), [04-NFR-technical.md §4.6](../../../docs/02-architecture/04-NFR-technical.md#L215), [10-observability-ci.md §4](../../../docs/02-architecture/10-observability-ci.md#L60)) |
| 초기 시드 적용 방식·시점과 Litpage 노출값, 실제 PostgreSQL 적용 검증, 10의 CI·헬스 제안 채택 및 적용 범위 | 일치 ([08-db-schema.md](../../../docs/02-architecture/08-db/08-db-schema.md#L364), [10-observability-ci.md §5·§7·§10](../../../docs/02-architecture/10-observability-ci.md#L67)) |
| Litpage B-1 RP 등록 URI, 진입 컨텍스트 전달, 세션 갱신·정지 후 차단 상한(Q-087), 백채널 도달·웹소켓 폐기·전파 실측, 드라이브 자동 저장·무손실 재열기 검증 | 일치 ([07-api.md](../../../docs/02-architecture/07-api/07-api.md#L258), [09-auth.md §11](../../../docs/02-architecture/09-auth.md#L380), [ADR 0004](../../../docs/decisions/0004-auth-idp-litpage.md#L123-L125), [open-questions.md](../../../docs/01-planning/02-decision-log/open-questions.md#L22)) |

---

## 6. 13과 04/05/07/08/09/10/ADR 0004 사이 불일치

- `13-cutover.md` 자체와 `04`, `05`, `07`, `08`, `09`, `ADR 0004` 사이의 내용 불일치는 확인되지 않음.
- 참고: [10-observability-ci.md §10](../../../docs/02-architecture/10-observability-ci.md#L131)에는 `09의 B-2 기본안 최종 채택은 호배님 결정 대기`라는 21:45 KST 결정 이전 문구가 남아 있으나, 이는 `10` 문서의 미갱신 사항이며 `13-cutover.md`는 B-1 기준으로 일관됨.

---

## 7. 검토하지 못한 부분과 이유

- **커밋 이력·수정 범위 (`[미확인]`)**: 현재 작업 폴더가 `.git`이 없는 읽기 전용 스냅샷이어서 `git log`·`git diff`로 `P2-13-cutover-codex-01` 잡이 다른 문서를 수정했는지 직접 검증할 수 없었음(파일 수정 시각 기준으로는 `13-cutover.md`만 `22:04`로 가장 늦음).
- **설계서 23장 원문 대조 (`[미확인]`)**: 저장소에서 설계서 23장 원문을 확인할 수 없어(10 §8·§10 및 07 미확인 표에서도 원문 미확인 상태) 요청문에 제시된 23장 정의 요약을 기준으로 대조함.
- **OpenAPI·SQL 파일 전문 대조**: [openapi.yaml](../../../docs/02-architecture/07-api/openapi.yaml)은 `/livez`·`/readyz` 미포함 여부만 검색 확인했고, [08-db/migrations/0001_init.sql](../../../docs/02-architecture/08-db/migrations/0001_init.sql) 전문은 검토하지 않고 `07-api.md`·`08-db-schema.md` 본문을 기준으로 대조함.