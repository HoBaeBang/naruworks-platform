# 디자인 결정 기록 (docs/03-ui-design)

기준: 기획 v1.0 (develop 4b66d1d). 이슈 #93, 브랜치 feature/NARU-93-ui-design.

| ID | 날짜 (Asia/Seoul) | 결정 | 근거·산출물 | 승인 |
|---|---|---|---|---|
| DES-001 | 2026-11-19 | 기존 브랜드(Grove Mint 팔레트, NA 모노그램)는 쓰지 않고 브랜드를 새로 만든다 | 호배님 결정 | 호배님 |
| DES-002 | 2026-11-19 12:14 | 브랜드 시안 A "Deep Ink (먹빛 나루)" 채택 (승인①). 톤: 신뢰·차분·정돈. Primary 라이트 #1E3A5F / 다크 #8DB4F5, 글꼴 IBM Plex Sans KR + IBM Plex Sans, 로고: 두 기슭을 잇는 아치 | brand/brand-concepts.md, brand/brand-concepts.figcraft, brand/exports/BRAND-A.png (B·C 시안은 비교 기록으로 보존) | 호배님 (승인①) |
| DES-003 | 2026-11-19 13:30 | 디자인 시스템 v0.2 승인 (승인②). 라이트·다크 색 토큰 각 31개, IBM Plex Sans KR 타이포 스케일, 4px 스페이싱, 컴포넌트 30종+, 로고 SVG. Gemini 재검수 review-02 blocking·major·minor 0건, 대비 최솟값 텍스트 4.70:1·UI 3.10:1 | design-system/design-system.md, design-system.figcraft, tokens.json, review-01.md, review-02.md, assets/, exports/ | 호배님 (승인②) |
| DES-004 | 2026-11-19 13:30 | 아이콘은 Lucide 대신 브랜드 A 스타일로 직접 그린다. v0.2 icons 페이지의 Lucide 37개는 대체 예정(제안 철회) | 호배님 결정 | 호배님 |

## 열린 사항
- 다크 모드·테마 선택(시스템/밝게/어둡게)과 저장 위치, 접근성(WCAG) 기준은 기획 NFR에 없음. 디자인은 대비 WCAG AA를 기본으로 가정. 자비스 차이 목록에 올라가 있음.
- 시안 PNG는 렌더러에 지정 글꼴이 없어 대체 글꼴로 보일 수 있음.
