# Naru Drive 설계 문서

Naru Drive는 NaruWorks 회원이 자신의 파일과 폴더를 관리하고, 이후 다른 회원과 안전하게 공유할 수 있게 하는 서비스다.

이 디렉터리는 Calendar·회원·인프라 문서와 섞이지 않는 Drive의 기준 문서다. 구현 이슈와 PR은 이 문서를 먼저 갱신하거나 참조한다.

| 문서 | 역할 | 현재 상태 |
| --- | --- | --- |
| [MVP 도메인 모델](mvp-domain-model.md) | 파일·폴더 ERD, 제약, 권한과 휴지통 정책 | 확정 |
| [MVP API 계약](mvp-api-contract.md) | 폴더·파일 목록, 업로드·다운로드 API와 오류 규칙 | 초안 확정 |
| [저장소와 전송 정책](storage-and-transfer.md) | RustFS, backend 중계 업로드, 객체 키, quota | 확정 |
| [구현 로드맵](implementation-roadmap.md) | 작은 이슈 단위의 구현 순서와 제외 범위 | 진행 예정 |

## MVP 범위

```text
포함
= 개인 루트, 폴더 관리, 파일 업로드·다운로드, 휴지통

제외
= 회원 간 공유, 공유 링크, 파일 버전, 미리보기, 직접 S3 업로드
```

현재는 RustFS를 Docker named volume과 함께 **개발 전용**으로 사용한다. 운영 사용자 파일을 보관하거나 백업 기준으로 사용하지 않는다. 구성 자체는 [개발용 Object Storage 운영 문서](../../ops/naru-drive-development-storage.md)에서 확인한다.
