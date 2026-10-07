# Naru Drive 구현 로드맵

## 완료된 기반

- Docker Compose RustFS 개발용 Object Storage
- private `naru-drive` 버킷 자동 생성
- Docker named volume 기반 테스트 저장소
- S3 endpoint와 credential 환경 변수 자리

## 다음 구현 이슈

| 순서 | 이슈 단위 | 완료 기준 |
| --- | --- | --- |
| 1 | Drive migration과 도메인 모델 | `drive_entries`, `drive_files`, enum, 제약·index, repository 테스트 |
| 2 | 개인 폴더 API와 화면 | 루트 조회, 폴더 생성·이름 변경·이동을 소유자만 수행 |
| 3 | 파일 업로드·다운로드 | backend 중계로 50 MB 이하 파일을 RustFS에 저장·다운로드 |
| 4 | 휴지통과 정리 job | 복원, 30일 만료 후보 조회, 객체·메타데이터 영구 정리 |
| 5 | Drive UI 다듬기 | 목록/그리드, 업로드 진행, 오류와 빈 상태, 모바일 대응 |
| 6 | 공유 설계와 구현 | 회원 권한 공유, 초대·해제, 공유 링크를 별도 이슈로 분리 |

각 구현 이슈는 `feature/NARU-이슈번호-짧은-영문-설명` 브랜치에서 `develop` 대상 PR로 진행한다. 자세한 절차는 [GitHub 작업 런북](../../development/git-github-session-runbook.md)을 따른다.

## 지금 하지 않는 것

- RustFS Console이나 S3 API의 외부 공개
- 브라우저 직접 S3 업로드와 pre-signed URL
- 운영 사용자 파일 보관, 전용 HDD, NAS, 외부 백업
- 파일 버전·미리보기·바이러스 검사·대용량 multipart upload
- 회원 간 공유·공개 링크
