# 기획 산출물 (docs/01-planning)

이슈: #91 · 브랜치: feature/NARU-91-planning-gap

기획 봇이 README(2026-11-11 버전)를 출발점으로 사용자와 대화하며 만든 기획 문서를 둔다.

## 기준선과 버전

**기획 기준선 v1.0 = develop 4b66d1d(승인⑤).**

- AC·UF v1.2에는 기준선 v1.0 확정본과 라운드 16~19(DEC-081~121) 반영분이 포함된다.
- 라운드 18·19(2026-11-26)의 문서 반영분은 호배님 승인 대기이다. 승인 기록은 결정 로그에서 관리한다.

| 문서 | 현재 버전 | 비고 |
|---|---|---|
| PRD | v1.2 | 1차 범위·제품 요구 및 재가입 데이터 복구 지표 갱신 |
| FRD | v1.4 | 라운드 18·19 기능 정책, 전용 WF가 없는 상태 설명 반영 |
| BR | v1.4 | 라운드 18·19 제품 규칙 반영 |
| NFR | v1.3 | 업로드·공유·복구·언어·테마의 적용 범위와 측정 기준 갱신 |
| AC | v1.2 | 모든 AC-FR-*는 Must, 개정 수용 기준 41개(신규 7개 포함) |
| UF | v1.2 | 라운드 18·19 사용자 흐름과 화면 상태 반영 |

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
| 01-interview/round-15.md, round-16.md, round-17.md, round-18.md, round-19.md 외 | 라운드별 질문과 답변 원문 | Q-### |
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

- Markdown이 원본이고 .docx는 pandoc으로 만든 생성물이다. 라운드 18·19 개정을 반영한 Markdown에서 표에 표시된 Word 문서 5종을 다시 생성했다.
- 비밀 값(.env, 키, 토큰)은 어떤 문서에도 적지 않는다. 보관 위치만 적는다(CO-01~03은 carry-over/README.md).
- 문서 안의 경로는 `drafts/...`가 아니라 `docs/01-planning/...` 실제 경로로 적는다.
