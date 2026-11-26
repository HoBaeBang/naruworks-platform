# 기획 산출물 (docs/01-planning)

이슈: #100 · 브랜치: `feature/NARU-100-planning-rebaseline`

기획 봇이 README(2026-11-11 버전)를 출발점으로 사용자와 대화하며 만든 기획 문서를 둔다.

## 기준선과 버전

**현재 기획 기준선은 develop `2f1db92`(PR #99 머지)이다.**

- 라운드 16~19(DEC-081~121) 반영분은 호배님 승인 완료다. 승인 기록은 결정 로그에서 관리한다.
- 라운드 20(DEC-122) 개정분은 호배님 승인 대기다.

| 문서 | 현재 버전 | 비고 |
|---|---|---|
| PRD | v1.2 | 라운드 16~19 반영분 승인 완료 |
| FRD | v1.5 | FR-DRV-003 분할 업로드 예외. 라운드 20 개정분 승인 대기 |
| BR | v1.5 | BR-024 분할 업로드 예외. 라운드 20 개정분 승인 대기 |
| NFR | v1.4 | NFR-PERF-002 분할 업로드 예외와 측정 기준. 라운드 20 개정분 승인 대기 |
| AC | v1.3 | 단일 업로드·분할 업로드 예외 및 CO-02 기록 검증. 라운드 20 개정분 승인 대기 |
| UF | v1.3 | UF-03 업로드 예외 흐름. 라운드 20 개정분 승인 대기 |

## 충돌 시 우선순위

문서 내용이 서로 다를 때는 다음 순서로 따른다.

1. 최신 DEC (결정 로그에서 번호가 큰 결정)
2. FRD·BR
3. AC·UF
4. NFR
5. PRD
6. glossary·서비스 정의

## 산출물 목록

경로는 모두 `docs/01-planning/` 아래이다.

| 경로 | 내용 | ID |
|---|---|---|
| 00-context/service-definition.md | 서비스 정의 v1.0 | - |
| 00-context/glossary.md | 용어집 | - |
| 01-interview/round-15.md, round-16.md, round-17.md, round-18.md, round-19.md, round-20.md 외 | 라운드별 질문과 답변 원문 | Q-### |
| 02-decision-log/decision-log.md | 결정 로그, 승인 기록 | DEC-### |
| 02-decision-log/open-questions.md | 열린 질문 | Q-### |
| prd/PRD.md | PRD (→ PRD.docx) | REQ-### |
| frd/FRD.md | FRD (→ FRD.docx) | FR-<영역>-### |
| business-rules/BR.md | 비즈니스 규칙 (→ Business-Rules.docx) | BR-### |
| nfr/NFR.md | NFR (→ NFR.docx) | NFR-<분류>-### |
| acceptance-criteria/AC.md | AC (→ Acceptance-Criteria.docx) | AC-<FR>-## |
| user-flow/UF.md | 사용자 흐름, FigCraft 원본·exports/ | UF-## |
| wireframe/ | FigCraft 원본(WF.figcraft), exports/ PNG | WF-## |
| traceability/matrix.csv | 요구·결정·수용 기준 및 PRD §6 성공 지표 추적표 | - |
| carry-over/README.md | 이어받는 설정(도메인, Cloudflare, 소셜 로그인)의 보관 위치. 비밀 값은 적지 않음 | CO-## |
| change-proposal-v1.2.md, change-proposal-prd-v1.1.md | 승인된 변경안(이력 보존) | - |
| gemini-consistency-review-01.md | Gemini 정합성 검토 | - |
| _templates, _tools | 문서 템플릿(reference.docx), 변환·검사 스크립트 | - |

[미확인] WF·UF 도식, Word 문서의 페이지 배치, Word 템플릿의 내부 내용은 이번 작업에서 검증하지 않았다.

## 작업 원칙

- Markdown이 원본이고 .docx는 pandoc으로 만든 생성물이다. 표에 표시된 Word 문서 5종은 `_tools/build-docx.sh`로 다시 생성한다.
- 비밀 값(.env, 키, 토큰)은 어떤 문서에도 적지 않는다. 보관 위치만 적는다(CO-01~03은 carry-over/README.md).
- 문서 안의 경로는 `drafts/...`가 아니라 `docs/01-planning/...` 실제 경로로 적는다.
