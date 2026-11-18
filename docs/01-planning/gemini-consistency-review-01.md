## 요약

전반적으로 `DEC-001~077`의 핵심 수치(30일 보관·자동 삭제, 업로드 1GB, 표시 이름 2~20 가중치, 사용자 100명·동시 접속 20명·월 99%), 목록 열 구성(`DEC-075`), 권한·화면 이동 규칙은 `FRD`·`BR`·`NFR`·`AC`·`UF`·와이어프레임 간에 잘 정합됩니다.
다만 **높음 1건**(`BR-021` 본문·출처 DEC에서 링크 보기 화면의 공통 헤더 규칙 `DEC-071`·`DEC-076` 누락)과 **중간 2건**(`FR-SHELL-001` 내부의 비회원 헤더 설명 충돌, `FRD` 「WF 예정」 및 `AC`·`UF`·`open-questions` 머리말의 승인④/v1.2 시차)을 포함해 총 6건의 모순·불일치를 발견했습니다.
동결 문서(`service-definition.md` v1.0, `PRD.md` v1.0)와 후속 결정의 차이(`C-01~C-03`)는 대부분 [change-proposal-v1.2.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/change-proposal-v1.2.md)로 추적되는 **의도된 차이**이나, `FR-ADM-004`(`DEC-034`) 및 `Q-081` 추가에 대한 PRD 대비 추적 주석은 보완이 필요합니다.

---

## 표 1: 발견한 모순

| 번호 | 심각도 | 위치들 | 내용 | 권장 수정 |
|---|---|---|---|---|
| M-01 | 높음 | [BR.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/business-rules/BR.md#L54) (`BR-021` L54, L186~188), [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L309) (`FR-DRV-007` L309), [matrix.csv](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/traceability/matrix.csv#L65-L66) ↔ [decision-log.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/02-decision-log/decision-log.md#L76-L83) (`DEC-071`, `DEC-076`), [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L172) (`FR-SHELL-001` L172, `FR-DRV-007` L311) | `BR-021`은 `적용 FR`에 `FR-DRV-007`을 넣었으나, 정작 규칙 본문에는 링크 보기 화면의 **공통 푸터**(`DEC-070`)만 적고 **공통 헤더(로그인 버튼, 로고·카테고리·서비스 전환 클릭 시 로그인 화면 이동)**(`DEC-071`, `DEC-076`)가 빠져 있으며 `출처 DEC`에도 두 번호가 누락됨. 반대로 `FR-DRV-007` `관련 BR`과 `matrix.csv`(65~66행)에는 `BR-021`이 빠져 있음(J-07). | `BR-021` 규칙 본문에 링크 보기 화면 공통 헤더 규칙(`DEC-071`, `DEC-076`)과 `출처 DEC`를 추가하고, `FR-DRV-007` `관련 BR` 및 `matrix.csv`에 `BR-021`을 보완. |
| M-02 | 중간 | [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L169-L173) (`FR-SHELL-001` 설명·입력/처리/결과 L169, L173 ↔ 사용자/권한 L172) | `FR-SHELL-001`의 `설명`·`입력·처리·결과`는 로그인 회원 화면만 전제해 "로고(누르면 홈으로 이동)", "카테고리를 누르면 서비스 목록 홈의 해당 카테고리 위치로 이동"이라 적고, `사용자/권한`은 링크 보기 화면에서 "로그인 버튼과 로고, 카테고리, 서비스 전환 메뉴를 누르면 모두 로그인 화면으로 이동(`DEC-076`)"한다고 적어 같은 FR 내부에서 이동 대상이 충돌함. | `FR-SHELL-001`의 `설명`과 `입력·처리·결과`에 링크 보기 화면(비회원)일 때의 예외(회원 메뉴 대신 로그인 버튼, 로고·카테고리·서비스 전환 클릭 시 로그인 화면 이동)를 명시. |
| M-03 | 중간 | [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L18) (L18, L46~71), [AC.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/acceptance-criteria/AC.md#L11-L17) (L11, L17), [UF.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/user-flow/UF.md#L11) (L11), [open-questions.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/02-decision-log/open-questions.md#L9) (L9) ↔ [decision-log.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/02-decision-log/decision-log.md#L96) (승인④) | 승인④에서 `WF-01~16`·`UF v0.7`·`AC v0.7`·`FRD·BR v1.2 변경안`이 승인되고 FRD·BR v1.2가 반영되었으나, `FRD`는 여전히 "화면 흐름 ID 미부여·「WF 예정」"으로 남아 있고, `AC`·`UF`·`open-questions` 머리말은 여전히 "v1.1 본문 수정 안 함 / 승인 전 변경 제안"을 전제함(J-01~J-04, C-04). | `AC`·`UF`·`open-questions` 머리말을 v1.2 반영·승인④ 완료 상태로 갱신하고, `FRD`의 「WF 예정」을 `WF-01~16` 참조로 바꿀지 결정. |
| M-04 | 낮음 | [NFR.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/nfr/NFR.md#L17) (§1 서론 L17) ↔ [open-questions.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/02-decision-log/open-questions.md#L13) (L13 `Q-081`) | `NFR.md` 서론은 "남은 항목은 `open-questions.md`의 설계 이관뿐이다"라고 적고 있으나, 라운드 14 이후 `Q-081`(사업자·운영자 정보 표시의 법적 필요 여부)이 열린 질문으로 추가되어 있음(J-10). | `NFR.md` 본문은 유지하고 서론 문구만 `Q-081`을 포함해 보강. |
| M-05 | 낮음 | [WF-11.png](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/wireframe/exports/WF-11.png) (캔버스 좌하단 `[상태 A]` ↔ 우측 주석 `[상태 A]`) ↔ [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L336) (`FR-ADM-001` L336), `DEC-074` | `DEC-074`는 일반 회원이 관리 URL로 직접 들어오면 **안내 없이 홈으로 보낸다**고 정했고 우측 주석도 이를 따르나, `WF-11` 캔버스 `[상태 A]` 상자에는 "관리 기능에 들어갈 수 없습니다."라는 안내 문구가 남아 있음. | `WF-11` 캔버스 `[상태 A]` 상자의 안내 문구를 제거하거나 "안내 없이 WF-02로 이동(표시 문구 없음)"으로 정정. |
| M-06 | 낮음 | [UF.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/user-flow/UF.md#L77-L78) (`UF-01` 흐름도 L77~78 ↔ `UF-01` 단계 7 L59, `UF-05` L318~319) | `UF-01` 단계 7과 `UF-05`는 "홈이 열린 뒤 그 위에 복구 안내 대화상자를 보여 준다"고 하나, `UF-01` 머메이드 흐름도는 `account --> restoreNotice --> home` 순서로 그려져 홈 진입 전 단계처럼 보임. | `UF-01` 흐름도를 `account --> home --> restoreNotice` 순으로 수정. |

*참고(동결 문서와의 추적 누락 차이)*: `PRD.md` v1.0 [§4 관리자](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/prd/PRD.md#L76)에는 `DEC-034`(`FR-ADM-004` 카테고리·배정 관리)가 포함되지 않았고(FRD에서 `REQ-007`로 매핑됨), [§9 열린 질문](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/prd/PRD.md#L167)은 라운드 05 해소 기준만 적고 있어 이후 추가된 `Q-081`을 반영하지 못합니다. 두 건 모두 동결로 인한 **의도된 차이**이나 `change-proposal-v1.2.md` 등에서 PRD 대비 차이로 별도 주석 추적은 되어 있지 않습니다.

---

## 표 2: C-01~C-05 판정

| 후보 | 판정 | 근거 위치 및 사유 |
|---|---|---|
| C-01 | **모순 아님 (의도된 차이)** | [PRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/prd/PRD.md#L101) `REQ-006`·§2·§4(동결, `DEC-025`) ↔ [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L180) `FR-SHELL-002`·[BR.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/business-rules/BR.md#L186) `BR-021`(`DEC-069`). [change-proposal-v1.2.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/change-proposal-v1.2.md#L17) §1·§2·§6에서 PRD v1.0을 고치지 않고 `Dev. Aslan0`·회사 정보 제외를 반영하기로 명시·승인함. |
| C-02 | **모순 아님 (의도된 차이)** | [PRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/prd/PRD.md#L102) `REQ-007`(동결, `DEC-013`) ↔ [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L169) `FR-SHELL-001`·`BR-021`(`DEC-067`). [change-proposal-v1.2.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/change-proposal-v1.2.md#L50-L60) §2·§4.1·§6에서 관리자 전용 '관리' 추가 및 PRD v1.0 유지를 명시·승인함. |
| C-03 | **모순 아님 (의도된 차이)** | [service-definition.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/00-context/service-definition.md#L17) §3·[PRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/prd/PRD.md#L101) `REQ-006`(동결) ↔ `FR-SHELL-001`·`FR-SHELL-002`·`FR-DRV-007`(`DEC-070`, `DEC-071`, `DEC-076`). 후속 라운드 14 결정으로 로그인 전 화면 푸터와 링크 보기 화면 헤더가 확장되었으며, `change-proposal-v1.2.md` §5.1~5.4에 추적됨. |
| C-04 | **실제 불일치 (문서 상태 시차)** | [decision-log.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/02-decision-log/decision-log.md#L96) 승인④에서 `WF(WF-01~16)`과 `UF v0.7`이 이미 승인되었으나, [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L18) 서론(L18)과 §3·각 FR(L46~71 등)이 여전히 "화면 흐름 ID 미부여·「WF 예정」"으로 남아 있음. |
| C-05 | **모순 아님 (의도된 미확정)** | [PRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/prd/PRD.md#L19) §1(L19)·§6(L130)은 성공 지표 목표 수치를 `[미확인]`으로 둔다고 명시하고, §9(L167)는 "**제품 요구**의 `[미확인]`"이 라운드 05에서 해소되었다고 구분해 적고 있어 문맥상 모순이 아님. |

---

## 표 3: J-01~J-10 권장 처리

| ID | 위치 | 권장 처리 | 사유 |
|---|---|---|---|
| J-01 | [AC.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/acceptance-criteria/AC.md#L11-L17) 문서 정보·서론 | **문서 머리말만 갱신** | 본문은 이미 `DEC-062~077`을 반영하므로, 상태·서론의 "v1.1 / 승인 전 변경 제안" 표현만 v1.2 반영·승인④ 완료로 갱신. |
| J-02 | [UF.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/user-flow/UF.md#L11) 문서 정보 | **문서 머리말만 갱신** | 본문은 최신이며, 상태란의 "FRD·BR·NFR v1.1 본문은 수정하지 않음"만 v1.2 반영 상태로 갱신. |
| J-03 | [open-questions.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/02-decision-log/open-questions.md#L9) 머리말 | **문서 머리말만 갱신** | L9의 "변경 제안에 제안한다"를 `change-proposal-v1.2.md` 승인·FRD·BR v1.2 반영 완료 상태로 갱신(`Q-081`과 설계 이관 2건은 유지). |
| J-04 | [FRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/frd/FRD.md#L18) 서론·각 FR 「WF 예정」 | **사람 결정 필요** | `WF-01~16`이 승인되었으므로 FRD에 `WF-01~16` ID를 직접 연결할지, FRD는 화면 ID 비종속 원칙으로 「WF 예정」 문구만 정리할지 결정 필요. |
| J-05 | [PRD.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/prd/PRD.md#L101-L102) 개요·범위표·`REQ-006`·`REQ-007` | **그대로 두고 주석** | 승인② 동결 문서이므로 본문은 유지하고 `change-proposal-v1.2.md`의 의도된 차이 기록으로 추적(PRD v1.1 개정은 선택 사항). |
| J-06 | [service-definition.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/00-context/service-definition.md#L17) 공통 화면 틀 | **그대로 두고 주석** | 승인① 동결 문서이므로 본문은 유지하고 후속 결정(`DEC-069`~`077`)은 결정 로그·FRD·BR로 추적. |
| J-07 | [BR.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/business-rules/BR.md#L54) `BR-021` ↔ `FR-DRV-007`, [matrix.csv](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/traceability/matrix.csv#L65-L66) | **본문 수정** | `FR-DRV-007` `관련 BR` 및 `matrix.csv` 행 65~66에 `BR-021`을 추가하고, `BR-021` 본문·출처 DEC에도 `DEC-071`, `DEC-076`을 함께 보완. |
| J-08 | [decision-log.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/02-decision-log/decision-log.md#L96) 승인④ 행 | **그대로 두고 주석** | 기존 승인④ 행은 이력으로 보존하고, 본문 반영·정합성 정리를 별도 `승인⑤` 행으로 남길지만 결정. |
| J-09 | 질문 번호 공백 (`Q-001~003, 007~008`) | **그대로 두고 주석** | 초기 라운드 번호 공백이며 대상 문서에서 인용하지 않으므로 추적상 영향 없음. |
| J-10 | [NFR.md](file:///Users/banghobae/.naru-orch/review/p1-8-consistency/docs/01-planning/nfr/NFR.md#L17) 서론 | **문서 머리말만 갱신** | NFR 본문 요구는 변경 대상이 아니며, 서론 L17의 "설계 이관뿐이다"에 `Q-081`을 포함해 보강. |

---

## 사람 결정이 필요한 질문 목록

1. **(`J-04`·`C-04`) `FRD.md`의 「WF 예정」 표기를 어떻게 정리할까요?**
   - 선택지 A: `FRD.md` 서론과 각 FR의 「WF 예정」을 승인된 `WF-01~16` ID로 매핑해 갱신한다.
   - 선택지 B: FRD는 화면 ID에 종속되지 않도록 서론의 "미부여" 문구만 삭제하고, `화면 필요 여부`는 `예` / `아니오`로만 둔다.
2. **(`J-08`) `FRD·BR v1.2` 본문 반영 및 이번 정합성 수정분을 `decision-log.md`에 `승인⑤`로 기록할까요?**
   - 선택지 A: 이번 정합성 보완(`M-01~M-06`, 머리말 갱신)을 반영한 뒤 `승인⑤` 행을 추가한다.
   - 선택지 B: `승인④` 기록으로 갈음하고 별도 승인 행은 두지 않는다.
3. **(`C-05`) `PRD.md` §6 성공 지표의 목표 수치(`[미확인]`)를 1차 출시 전에 확정할까요, 출시 후 관측용으로 둘까요?**
   - 선택지 A: 1차 출시 전 별도 결정(`DEC`)으로 목표 수치를 정한다.
   - 선택지 B: 1차는 지인 위주 100명 이내 운영이므로 목표 수치 없이 출시 후 기준선만 관측한다.
4. **(`Q-081`) 개인 개발자(`Dev. Aslan0`) 기준에서 사업자·운영자 정보 표시의 법적 필요 여부** — 법률 확인 후 확정 필요(`[미확인]`).
