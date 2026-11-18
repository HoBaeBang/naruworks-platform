# 기획 산출물 (docs/01-planning)

이슈: #91 · 브랜치: feature/NARU-91-planning

기획 봇이 README(2026-11-11 버전)를 출발점으로 사용자와 대화하며 만든 기획 문서를 둔다. 아직 빈 뼈대다.

| 폴더 | 내용 | ID |
|---|---|---|
| 00-context | README 분석, 용어집 | - |
| 01-interview | 라운드별 질문과 답변 원문 | Q-### |
| 02-decision-log | 결정 로그, 남은 질문 | DEC-### |
| prd | PRD.md → PRD.docx | REQ-### |
| frd | FRD.md → FRD.docx | FR-<영역>-### |
| business-rules | BR.md → Business-Rules.docx | BR-### |
| nfr | NFR.md → NFR.docx | NFR-<분류>-### |
| acceptance-criteria | AC.md → Acceptance-Criteria.docx | AC-<FR>-## |
| user-flow | FigCraft 원본, exports/ PNG, 색인 | UF-## |
| wireframe | FigCraft 원본, exports/ PNG, 색인 | WF-## |
| traceability | 추적표 원본(matrix.csv)과 검사 결과 | - |
| carry-over | 이어받는 설정(도메인, Cloudflare, 소셜 로그인). 비밀 값은 적지 않고 보관 위치만 | CO-## |
| _templates | 문서 템플릿, reference.docx | - |
| _tools | 변환·검사 스크립트 | - |

- Markdown이 원본이고 .docx는 pandoc으로 만든 생성물이다.
- 비밀 값(.env, 키, 토큰)은 어떤 문서에도 적지 않는다.
